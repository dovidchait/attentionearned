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
// WhatsApp also has sendTemplate(route, contentSid, variables) for messages
// outside WhatsApp's 24-hour window. Branding, opt-outs and the 24-hour rule
// live in lib/notify.js; channels only move bytes.
// A reply route ({ channel, to, from }) is stored on the Zernio post's metadata,
// so a webhook days later still knows where to answer, even after a restart.
//
// To move WhatsApp to Meta's WhatsApp Cloud API, add a `whatsappCloud` channel
// with the same functions and point the webhook at it. Nothing else changes.
// Env is read when used (not at import), so tests and `fly secrets` both work.
// ============================================================================

const env = name => process.env[name];

export function smsEnabled() {
  return String(env('SMS_ENABLED') || '').toLowerCase() === 'true';
}

let twilioClient = null;
let twilioClientKey = null;
function getTwilioClient() {
  if (twilioClient && twilioClientKey === 'injected') return twilioClient;
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) return null;
  if (!twilioClient || twilioClientKey !== `${sid}:${token}`) {
    twilioClient = twilio(sid, token);
    twilioClientKey = `${sid}:${token}`;
  }
  return twilioClient;
}

/** Tests: use a fake Twilio client ({ messages: { create } }). Pass null to undo. */
export function setTwilioClient(client) {
  twilioClient = client;
  twilioClientKey = client ? 'injected' : null;
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
// Twilio signature check (X-Twilio-Signature, HMAC-SHA1 of URL + sorted params)
// ----------------------------------------------------------------------------

export function twilioSignatureValid(req) {
  if (String(env('TWILIO_SKIP_SIGNATURE_CHECK') || '').toLowerCase() === 'true') return true; // local tests only
  const token = env('TWILIO_AUTH_TOKEN');
  if (!token) {
    console.error('TWILIO_AUTH_TOKEN is not set, so Twilio webhooks cannot be verified (set TWILIO_SKIP_SIGNATURE_CHECK=true only for local tests)');
    return false;
  }
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;
  // PUBLIC_BASE_URL pins the exact URL Twilio signed (e.g. https://text-to-attention.fly.dev)
  const base = (env('PUBLIC_BASE_URL') || '').replace(/\/$/, '');
  const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const url = base ? `${base}${req.originalUrl}` : `${protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(token, signature, url, req.body || {});
}

// ----------------------------------------------------------------------------
// Twilio (SMS/MMS and WhatsApp share everything but the address prefix)
// ----------------------------------------------------------------------------

function twilioChannel({ name, prefix, maxMediaMb }) {
  const strip = value => (value || '').replace(/^whatsapp:/, '');
  const address = value => (prefix ? `${prefix}${strip(value)}` : strip(value));
  const fromFor = route => (name === 'whatsapp'
    ? env('TWILIO_WHATSAPP_FROM') || route.from
    : route.from || env('TWILIO_FROM_NUMBER'));

  return {
    name,
    maxMediaMb,

    verify(req) {
      return twilioSignatureValid(req);
    },

    async parse(req) {
      const body = req.body || {};
      const count = parseInt(body.NumMedia, 10) || 0;
      const media = [];
      for (let i = 0; i < count; i++) {
        media.push({ url: body[`MediaUrl${i}`], contentType: body[`MediaContentType${i}`] || 'application/octet-stream', index: i });
      }
      return {
        from: strip(body.From),
        to: strip(body.To),
        text: body.Body || '',
        subject: '',
        messageId: body.MessageSid || body.SmsMessageSid || null,
        media
      };
    },

    ack(res, text) {
      const twiml = new twilio.twiml.MessagingResponse();
      if (text) twiml.message(text);
      res.type('text/xml').send(twiml.toString());
    },

    async send(route, text) {
      if (name === 'sms' && !smsEnabled()) throw new Error('SMS is off (set SMS_ENABLED=true once the toll-free number is verified)');
      const client = getTwilioClient();
      if (!client) throw new Error('Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
      const from = fromFor(route);
      if (!from) throw new Error(`No ${name} sender number (${name === 'whatsapp' ? 'TWILIO_WHATSAPP_FROM' : 'TWILIO_FROM_NUMBER'})`);
      return client.messages.create({ from: address(from), to: address(route.to), body: text });
    },

    async downloadMedia(item) {
      const sid = env('TWILIO_ACCOUNT_SID');
      const token = env('TWILIO_AUTH_TOKEN');
      const headers = sid && token ? { 'Authorization': `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } : {};
      const response = await fetchWithTimeout(item.url, { headers }, 120000);
      if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
      const declared = parseInt(response.headers.get('content-length') || '0', 10);
      if (maxMediaMb && declared > maxMediaMb * 1024 * 1024) throw new Error(`over ${maxMediaMb} MB`);
      const contentType = item.contentType && item.contentType !== 'application/octet-stream'
        ? item.contentType
        : (response.headers.get('content-type') || item.contentType);
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, contentType, filename: `${name}-${Date.now()}-${item.index}.${extensionFor(contentType)}` };
    }
  };
}

const whatsapp = twilioChannel({ name: 'whatsapp', prefix: 'whatsapp:', maxMediaMb: 16 });

/**
 * Approved WhatsApp template through Twilio's Content API (works outside the
 * 24-hour window). variables: { "1": "...", "2": "..." }
 */
whatsapp.sendTemplate = async function sendTemplate(route, contentSid, variables) {
  const client = getTwilioClient();
  if (!client) throw new Error('Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  const from = env('TWILIO_WHATSAPP_FROM') || route.from;
  if (!from) throw new Error('No WhatsApp sender number (TWILIO_WHATSAPP_FROM)');
  const strip = value => (value || '').replace(/^whatsapp:/, '');
  return client.messages.create({
    from: `whatsapp:${strip(from)}`,
    to: `whatsapp:${strip(route.to)}`,
    contentSid,
    contentVariables: JSON.stringify(variables)
  });
};

// ----------------------------------------------------------------------------
// Email
// Inbound: Postmark inbound webhook (JSON), raw message/rfc822 (e.g. a
//          Cloudflare Email Worker), or simple JSON {from, subject, text, attachments}.
// Outbound: Postmark (POSTMARK_SERVER_TOKEN) or Emailit (EMAILIT_API_KEY).
// ----------------------------------------------------------------------------

function escapeHtml(text = '') {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export async function sendEmail(to, subject, textBody, { replyTo, inReplyTo } = {}) {
  const from = env('EMAIL_FROM');
  if (env('POSTMARK_SERVER_TOKEN')) {
    if (!from) throw new Error('EMAIL_FROM is not set (must be a Postmark-verified sender)');
    const payload = { From: from, To: to, Subject: subject, TextBody: textBody, MessageStream: env('POSTMARK_MESSAGE_STREAM') || 'outbound' };
    if (replyTo) payload.ReplyTo = replyTo;
    if (inReplyTo) payload.Headers = [{ Name: 'In-Reply-To', Value: inReplyTo }, { Name: 'References', Value: inReplyTo }];
    const base = (env('POSTMARK_API_URL') || 'https://api.postmarkapp.com').replace(/\/$/, '');
    const response = await fetchWithTimeout(`${base}/email`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': env('POSTMARK_SERVER_TOKEN') },
      body: JSON.stringify(payload)
    }, 15000);
    if (!response.ok) throw new Error(`Postmark error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.json().catch(() => ({}));
  }
  if (env('EMAILIT_API_KEY')) {
    const payload = { to: [{ email: to }], subject, text: textBody, html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(textBody)}</pre>` };
    if (from) payload.from = from;
    if (replyTo) payload.reply_to = replyTo;
    const response = await fetchWithTimeout('https://api.emailit.com/v1/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env('EMAILIT_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 15000);
    if (!response.ok) throw new Error(`Emailit error: ${await response.text()}`);
    return {};
  }
  throw new Error('Email is not configured (set POSTMARK_SERVER_TOKEN + EMAIL_FROM)');
}

function header(headers, name) {
  return (headers || []).find(h => String(h.Name || h.name).toLowerCase() === name.toLowerCase())?.Value;
}

function isPostmark(body) {
  return body && (body.FromFull || body.TextBody !== undefined || body.MessageID || Array.isArray(body.Attachments));
}

const emailChannel = {
  name: 'email',
  maxMediaMb: 35,

  verify(req) {
    // Shared secret: set EMAIL_WEBHOOK_SECRET and add ?secret=... to the inbound webhook URL
    const secret = env('EMAIL_WEBHOOK_SECRET');
    if (secret && req.query.secret !== secret && req.headers['x-webhook-secret'] !== secret) return false;
    // A forged "From:" could post to someone's socials. When the inbound provider
    // reports SPF (Postmark's Received-SPF header), require a pass.
    if (String(env('EMAIL_REQUIRE_SPF') || 'true').toLowerCase() !== 'false' && isPostmark(req.body)) {
      const spf = header(req.body.Headers, 'Received-SPF');
      if (spf && !/^\s*pass\b/i.test(spf)) {
        console.error(`Email rejected: SPF is "${spf.split(' ')[0]}" for ${req.body.From}`);
        return false;
      }
    }
    return true;
  },

  async parse(req) {
    let data;
    const body = req.body;
    if (req.headers['content-type']?.includes('message/rfc822') || Buffer.isBuffer(body)) {
      const parsed = await mailparser.simpleParser(body);
      data = {
        from: parsed.from?.text, to: parsed.to?.text, subject: parsed.subject, text: parsed.text,
        messageId: parsed.messageId,
        attachments: (parsed.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content }))
      };
    } else if (isPostmark(body)) {
      data = {
        from: body.FromFull?.Email || body.From,
        to: body.OriginalRecipient || body.ToFull?.[0]?.Email || body.To,
        subject: body.Subject,
        text: body.StrippedTextReply || body.TextBody || '',
        messageId: header(body.Headers, 'Message-ID') || body.MessageID,
        attachments: (body.Attachments || []).map(a => ({ filename: a.Name, contentType: a.ContentType, content: a.Content }))
      };
    } else {
      data = body || {};
    }
    const attachments = data.attachments || [];
    return {
      from: extractEmail(data.from || data.email || ''),
      to: data.to ? extractEmail(data.to) : null,
      text: data.text || data['body-plain'] || '',
      subject: data.subject || '',
      messageId: data.messageId || data['Message-Id'] || null,
      media: attachments
        .map((a, index) => ({ attachment: a, contentType: (a.contentType || a.type || 'application/octet-stream').toLowerCase(), index }))
        .filter(m => m.contentType.startsWith('image/') || m.contentType.startsWith('video/'))
    };
  },

  ack(res, text) {
    res.status(200).json({ success: true, message: text || null });
  },

  async send(route, text) {
    const firstLine = text.split('\n')[0].slice(0, 120);
    return sendEmail(route.to, firstLine, text, {
      replyTo: env('EMAIL_REPLY_TO') || route.from || undefined,
      inReplyTo: route.inReplyTo || undefined
    });
  },

  async downloadMedia(item) {
    const a = item.attachment;
    const content = a.content || a.data;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64');
    return { buffer, contentType: item.contentType, filename: a.filename || `email-${Date.now()}-${item.index}.${extensionFor(item.contentType)}` };
  }
};

export const channels = {
  sms: twilioChannel({ name: 'sms', prefix: '', maxMediaMb: 5 }),
  whatsapp,
  email: emailChannel
};
