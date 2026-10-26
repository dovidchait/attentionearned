import twilio from 'twilio';
import mailparser from 'mailparser';
import fetch from 'node-fetch';
import { extractEmail } from './users.js';

// ============================================================================
// CHANNELS (pluggable inbound/outbound)
// Each channel knows how to:
//   verify(req)            -> true if the webhook really came from the provider
//   parse(req)             -> { from, to, text, subject, messageId, media: [...] }
//   ack(res, text)         -> answer the webhook right away
//   send(route, text)      -> send a message later (the "where it went" reply)
//   downloadMedia(item)    -> { buffer, contentType, filename }
// A reply route ({ channel, to, from }) is stored on the Zernio post's metadata,
// so a webhook days later still knows where to answer, even after a restart.
//
// To move WhatsApp to Meta's WhatsApp Cloud API, add a `whatsappCloud` channel
// with the same five functions and point the webhook at it. Nothing else changes.
// ============================================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const EMAILIT_API_KEY = process.env.EMAILIT_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM; // optional, e.g. "Text to Attention <post@attentionearned.com>"

let twilioClient = null;
function getTwilioClient() {
  if (!twilioClient && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return twilioClient;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extensionFor(contentType = '') {
  const sub = contentType.split('/')[1] || 'bin';
  return { jpeg: 'jpg', quicktime: 'mov', '3gpp': '3gp' }[sub] || sub.split(';')[0];
}

// ----------------------------------------------------------------------------
// Twilio (SMS/MMS and WhatsApp share everything but the address prefix)
// ----------------------------------------------------------------------------

function twilioChannel({ name, prefix }) {
  const strip = value => (value || '').replace(/^whatsapp:/, '');
  const address = value => (prefix ? `${prefix}${strip(value)}` : strip(value));

  return {
    name,

    verify(req) {
      if (!TWILIO_AUTH_TOKEN) return true; // local dev only; always set it in production
      const signature = req.headers['x-twilio-signature'];
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const url = `${protocol}://${req.get('host')}${req.originalUrl}`;
      return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body);
    },

    async parse(req) {
      const count = parseInt(req.body.NumMedia, 10) || 0;
      const media = [];
      for (let i = 0; i < count; i++) {
        media.push({ url: req.body[`MediaUrl${i}`], contentType: req.body[`MediaContentType${i}`] || 'application/octet-stream', index: i });
      }
      return {
        from: strip(req.body.From),
        to: strip(req.body.To),
        text: req.body.Body || '',
        subject: '',
        messageId: req.body.MessageSid,
        media
      };
    },

    ack(res, text) {
      const twiml = new twilio.twiml.MessagingResponse();
      if (text) twiml.message(text);
      res.type('text/xml').send(twiml.toString());
    },

    async send(route, text) {
      const client = getTwilioClient();
      if (!client) throw new Error('Twilio is not configured');
      const from = route.from || (name === 'whatsapp' ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_FROM_NUMBER);
      // WhatsApp only allows free-form replies within 24h of the person's last
      // message. A scheduled post that goes live later than that needs an
      // approved template (see README). Twilio's error says so if it happens.
      await client.messages.create({ from: address(from), to: address(route.to), body: text });
    },

    async downloadMedia(item) {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      const response = await fetchWithTimeout(item.url, { headers: { 'Authorization': `Basic ${auth}` } }, 60000);
      if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
      const contentType = response.headers.get('content-type') || item.contentType;
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, contentType: item.contentType || contentType, filename: `${name}-${Date.now()}-${item.index}.${extensionFor(item.contentType || contentType)}` };
    }
  };
}

// ----------------------------------------------------------------------------
// Email (inbound webhook as JSON or raw message/rfc822; outbound via Emailit)
// ----------------------------------------------------------------------------

export async function sendEmail(to, subject, textBody, htmlBody) {
  if (!EMAILIT_API_KEY) {
    console.warn('⚠️  EMAILIT_API_KEY not configured, skipping email');
    return;
  }
  const payload = { to: [{ email: to }], subject, text: textBody, html: htmlBody || `<pre style="font-family:inherit">${escapeHtml(textBody)}</pre>` };
  if (EMAIL_FROM) payload.from = EMAIL_FROM;
  const response = await fetchWithTimeout('https://api.emailit.com/v1/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${EMAILIT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, 15000);
  if (!response.ok) throw new Error(`Emailit error: ${await response.text()}`);
}

function escapeHtml(text = '') {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const emailChannel = {
  name: 'email',

  verify(req) {
    // Optional shared secret: set EMAIL_WEBHOOK_SECRET and add ?secret=... to the inbound webhook URL
    const secret = process.env.EMAIL_WEBHOOK_SECRET;
    return !secret || req.query.secret === secret || req.headers['x-webhook-secret'] === secret;
  },

  async parse(req) {
    let data;
    if (req.headers['content-type']?.includes('message/rfc822')) {
      const parsed = await mailparser.simpleParser(req.body);
      data = { from: parsed.from?.text, subject: parsed.subject, text: parsed.text, attachments: parsed.attachments, messageId: parsed.messageId };
    } else {
      data = req.body || {};
    }
    const attachments = data.attachments || [];
    return {
      from: extractEmail(data.from || data.email || ''),
      to: data.to || null,
      text: data.text || data['body-plain'] || '',
      subject: data.subject || '',
      messageId: data.messageId || data['Message-Id'] || null,
      media: attachments
        .map((a, index) => ({ attachment: a, contentType: a.contentType || a.type || 'application/octet-stream', index }))
        .filter(m => m.contentType.startsWith('image/') || m.contentType.startsWith('video/'))
    };
  },

  ack(res, text) {
    res.status(202).json({ success: true, message: text });
  },

  async send(route, text) {
    const firstLine = text.split('\n')[0].slice(0, 120);
    await sendEmail(route.to, firstLine, text);
  },

  async downloadMedia(item) {
    const a = item.attachment;
    const content = a.content || a.data;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64');
    return { buffer, contentType: item.contentType, filename: a.filename || `email-${Date.now()}-${item.index}.${extensionFor(item.contentType)}` };
  }
};

export const channels = {
  sms: twilioChannel({ name: 'sms', prefix: '' }),
  whatsapp: twilioChannel({ name: 'whatsapp', prefix: 'whatsapp:' }),
  email: emailChannel
};

/** Send a reply on the route stored with the post. */
export async function reply(route, text) {
  const channel = channels[route?.channel];
  if (!channel) throw new Error(`Unknown reply channel: ${route?.channel}`);
  await channel.send(route, text);
}
