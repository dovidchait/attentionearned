import twilio from 'twilio';
import mailparser from 'mailparser';
import fetch from 'node-fetch';
import { extractEmail } from './users.js';
import { sendEmailit, DEFAULT_FROM } from './emailit.js';

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
// Email (Emailit in and out, see lib/emailit.js)
// Inbound: Emailit's signed email.received webhook (lib/emailit.js fetches the
//          message and hands it here as simple JSON), or, from any other
//          forwarder, raw message/rfc822 or simple JSON {from, subject, text,
//          attachments} with EMAIL_WEBHOOK_SECRET.
// Outbound: Emailit POST /emails, threaded under the client's email.
// ----------------------------------------------------------------------------

function escapeHtml(text = '') {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function replySubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return '';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export async function sendEmail(to, subject, textBody, { replyTo, inReplyTo, references } = {}) {
  const from = env('EMAIL_FROM') || DEFAULT_FROM;
  const payload = {
    from,
    to,
    subject,
    text: textBody,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(textBody)}</pre>`,
    tracking: false
  };
  if (replyTo && extractEmail(replyTo) !== extractEmail(from)) payload.reply_to = replyTo;
  if (inReplyTo) {
    payload.headers = {
      'In-Reply-To': inReplyTo,
      'References': [references, inReplyTo].filter(Boolean).join(' ').trim()
    };
  }
  return sendEmailit(payload);
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (Array.isArray(headers)) return headers.find(h => String(h.Name || h.name).toLowerCase() === name.toLowerCase())?.Value;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/**
 * A forged "From:" could post to someone's socials. When the receiving server
 * recorded SPF/DKIM/DMARC results, refuse mail that fails them.
 * Returns null when fine (or nothing to check), else the reason.
 */
export function authFailure(headers) {
  const results = String(headerValue(headers, 'Authentication-Results') || '').toLowerCase();
  const receivedSpf = String(headerValue(headers, 'Received-SPF') || '').toLowerCase().trim();
  if (results) {
    if (/\bdmarc=fail\b/.test(results)) return 'DMARC failed';
    const spfPass = /\bspf=pass\b/.test(results);
    const dkimPass = /\bdkim=pass\b/.test(results);
    if (/\bspf=/.test(results) && !spfPass && !dkimPass) return 'SPF and DKIM did not pass';
    return null;
  }
  if (receivedSpf && /^(fail|softfail)\b/.test(receivedSpf)) return `SPF ${receivedSpf.split(/\s/)[0]}`;
  return null;
}

/** Drop the quoted thread under a reply ("On ... wrote:", "> ...", Outlook headers). */
export function stripQuotedReply(text = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const joined = `${line} ${lines[i + 1] || ''}`;
    if (/^\s*On\s.+wrote:\s*$/i.test(line)) break;
    if (/^\s*On\s/i.test(line) && line.length < 200 && /wrote:\s*$/i.test(lines[i + 1] || '')) break; // Gmail wraps the line
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From: .+/i.test(line) && i > 0 && lines[i - 1].trim() === '' && /^\s*(Sent|Date|To|Subject):/i.test(lines[i + 1] || '')) break;
    if (/^\s*_{10,}\s*$/.test(line)) break; // Outlook separator
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

const emailChannel = {
  name: 'email',
  maxMediaMb: 35,

  verify(req) {
    // Emailit requests are checked (HMAC signature) in lib/emailit.js before they get here.
    if (!req.emailitVerified) {
      // Any other forwarder: shared secret in ?secret=... or X-Webhook-Secret. Required:
      // without it anyone could post as a client by typing their address.
      const secret = env('EMAIL_WEBHOOK_SECRET');
      if (!secret) {
        console.error('Email webhook refused: not an Emailit request and EMAIL_WEBHOOK_SECRET is not set');
        return false;
      }
      if (req.query?.secret !== secret && req.headers?.['x-webhook-secret'] !== secret) return false;
    }
    if (String(env('EMAIL_REQUIRE_AUTH') || 'true').toLowerCase() !== 'false' && req.body && !Buffer.isBuffer(req.body)) {
      const reason = authFailure(req.body.headers);
      if (reason) {
        console.error(`Email rejected: ${reason} for ${req.body.from}`);
        return false;
      }
    }
    return true;
  },

  async parse(req) {
    let data;
    const body = req.body;
    if (req.headers?.['content-type']?.includes('message/rfc822') || Buffer.isBuffer(body)) {
      const parsed = await mailparser.simpleParser(body);
      const reason = String(env('EMAIL_REQUIRE_AUTH') || 'true').toLowerCase() !== 'false'
        ? authFailure({ 'Authentication-Results': parsed.headers.get('authentication-results'), 'Received-SPF': parsed.headers.get('received-spf') })
        : null;
      if (reason) {
        console.error(`Email rejected: ${reason} for ${parsed.from?.text}`);
        return { from: null, media: [] };
      }
      data = {
        from: parsed.from?.text, to: parsed.to?.text, subject: parsed.subject, text: parsed.text,
        messageId: parsed.messageId,
        references: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references,
        attachments: (parsed.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content }))
      };
    } else {
      data = body || {};
    }
    const attachments = data.attachments || [];
    return {
      from: extractEmail(data.from || data.email || ''),
      to: data.to ? extractEmail(data.to) : null,
      text: stripQuotedReply(data.text || data['body-plain'] || ''),
      subject: data.subject || '',
      messageId: data.messageId || data['Message-Id'] || null,
      references: data.references || '',
      media: attachments
        .map((a, index) => ({ attachment: a, contentType: (a.contentType || a.type || 'application/octet-stream').toLowerCase(), index }))
        .filter(m => m.contentType.startsWith('image/') || m.contentType.startsWith('video/'))
    };
  },

  ack(res, text) {
    res.status(200).json({ success: true, message: text || null });
  },

  async send(route, text) {
    const subject = replySubject(route.subject) || `Attention Earned: ${text.replace(/^Attention Earned:\s*/, '').split('\n')[0].slice(0, 100)}`;
    return sendEmail(route.to, subject, text, {
      replyTo: env('EMAIL_REPLY_TO') || route.from || undefined,
      inReplyTo: route.inReplyTo || undefined,
      references: route.references || undefined
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
