import crypto from 'crypto';
import fetch from 'node-fetch';

// ============================================================================
// EMAILIT (https://emailit.com/docs) — email in and out
// Outbound: POST {EMAILIT_API_URL}/emails with Authorization: Bearer EMAILIT_API_KEY
// Inbound:  Emailit receives mail for <anything>@inbound.<your domain> (one MX
//           record), then calls our webhook with signed `email.received` events
//           (a JSON array, up to 100 per request). The event only carries the
//           email's ID, so we fetch the parsed message (body, headers,
//           attachments as base64) with GET {EMAILIT_API_URL}/emails/{id}.
//           Reading inbound mail needs a Full Access API key.
// Signature: X-Emailit-Signature = hex HMAC-SHA256 of "{X-Emailit-Timestamp}.{raw body}"
//           keyed with the webhook secret (whole value, including "whsec_").
// ============================================================================

const env = name => process.env[name];
export const DEFAULT_FROM = 'Attention Earned <post@attentionearned.com>';

// ---------------------------------------------------------------------------
// Address env values (EMAIL_FROM, EMAIL_REPLY_TO) are pasted into dashboards by
// hand, so they often arrive with stray spaces or the quotes from a shell
// command saved as part of the value ("Attention Earned <post@...>" with the
// quotes). Emailit refuses those with 400 "Invalid from email address", so we
// clean them up here and fall back to a safe default instead of failing.
// ---------------------------------------------------------------------------
const BARE_ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const warned = new Set();

/** Trim and remove matching surrounding quotes ("x", 'x', “x”), repeatedly. */
export function cleanEnvString(value) {
  let s = String(value ?? '').trim();
  for (;;) {
    const m = s.match(/^(["'\u201C\u2018])([\s\S]*)(["'\u201D\u2019])$/);
    if (!m || s.length < 2) return s;
    s = m[2].trim();
  }
}

/**
 * "addr@x.com" or "Name <addr@x.com>" (quotes around the name allowed) -> a clean
 * address string, or null when it isn't one.
 */
export function normalizeAddress(value) {
  const s = cleanEnvString(value);
  if (!s) return null;
  if (BARE_ADDRESS.test(s)) return s;
  const m = s.match(/^([^<>]*?)\s*<\s*([^<>\s]+)\s*>$/);
  if (!m || !BARE_ADDRESS.test(m[2])) return null;
  const name = cleanEnvString(m[1]).replace(/["<>]/g, '').trim();
  return name ? `${name} <${m[2]}>` : m[2];
}

/** Read an address env var; blank -> fallback; invalid -> fallback plus one warning. */
export function addressFromEnv(name, fallback) {
  const raw = env(name);
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const clean = normalizeAddress(raw);
  if (clean) return clean;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`⚠️  ${name} is not a valid email address (expected addr@domain or "Name <addr@domain>"); using ${fallback || 'no value'} instead`);
  }
  return fallback;
}

/** The From for every outgoing email: EMAIL_FROM cleaned up, else DEFAULT_FROM. */
export function fromAddress() {
  return addressFromEnv('EMAIL_FROM', DEFAULT_FROM);
}

/** Reply-To from EMAIL_REPLY_TO cleaned up, or undefined when unset/invalid. */
export function replyToAddress() {
  return addressFromEnv('EMAIL_REPLY_TO', undefined);
}
const TOLERANCE_SECONDS = 300;

function apiBase() {
  return (env('EMAILIT_API_URL') || 'https://api.emailit.com/v2').replace(/\/$/, '');
}

async function call(path, options = {}, timeoutMs = 20000) {
  const key = env('EMAILIT_API_KEY');
  if (!key) throw new Error('Email is not configured (set EMAILIT_API_KEY)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Emailit error ${response.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return {}; }
  } finally {
    clearTimeout(timer);
  }
}

/** POST /emails. payload: { from, to, subject, text, html, reply_to, headers, tracking, meta } */
export function sendEmailit(payload) {
  return call('/emails', { method: 'POST', body: JSON.stringify(payload) });
}

/** GET /emails/{id}: the parsed inbound message (needs a Full Access key). */
export function fetchEmail(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id || ''))) throw new Error(`Bad Emailit email id: ${id}`);
  return call(`/emails/${encodeURIComponent(id)}`, { method: 'GET' });
}

export function verifyEmailitSignature(rawBody, signature, timestamp, secret = env('EMAILIT_WEBHOOK_SECRET'), now = Date.now()) {
  if (!secret || !rawBody || !signature || !timestamp) return false;
  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (!(age <= TOLERANCE_SECONDS)) return false; // also rejects non-numeric timestamps
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signEmailitBody(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return { 'X-Emailit-Signature': signature, 'X-Emailit-Timestamp': String(timestamp) };
}

function htmlToText(html = '') {
  return String(html)
    .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Emailit's GET /emails/{id} object -> the email channel's simple JSON shape. */
export function toInboundMessage(email) {
  const headers = email.headers || {};
  return {
    from: headers.From || headers.from || email.from,
    to: email.to,
    subject: email.subject || '',
    text: email.body?.text || htmlToText(email.body?.html || ''),
    messageId: email.message_id || headers['Message-ID'] || headers['Message-Id'] || null,
    references: headers.References || headers.references || '',
    headers,
    attachments: (email.attachments || [])
      .filter(a => a && a.content)
      .map(a => ({ filename: a.filename, contentType: a.content_type || a.contentType, content: a.content }))
  };
}

// Recently handled event IDs (Emailit retries a whole batch if any part fails)
const seen = new Map();
function remember(id) {
  seen.set(id, Date.now());
  if (seen.size > 2000) seen.delete(seen.keys().next().value);
}

function fakeResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json() { this.headersSent = true; return this; },
    send() { this.headersSent = true; return this; },
    type() { return this; },
    end() { this.headersSent = true; return this; }
  };
}

export function isEmailitRequest(req) {
  return Boolean(req.get?.('X-Emailit-Signature') || req.headers?.['x-emailit-signature'] || req.headers?.['x-emailit-timestamp']);
}

/**
 * Express handler for /email-webhook.
 * Emailit requests (signed): verify, fetch each received email, run it through
 * `handleEmail` (the posting pipeline's email handler), then answer 200.
 * Anything else (raw message/rfc822 or simple JSON from another forwarder)
 * goes straight to `handleEmail`, which checks EMAIL_WEBHOOK_SECRET.
 */
export function emailWebhook(handleEmail) {
  return async (req, res) => {
    if (!isEmailitRequest(req)) return handleEmail(req, res);

    if (!env('EMAILIT_WEBHOOK_SECRET')) {
      console.error('Emailit webhook refused: EMAILIT_WEBHOOK_SECRET is not set');
      return res.status(401).send('Webhook secret not configured');
    }
    const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    if (!verifyEmailitSignature(raw, req.headers['x-emailit-signature'], req.headers['x-emailit-timestamp'])) {
      console.error('Invalid Emailit webhook signature');
      return res.status(401).send('Invalid signature');
    }

    let events;
    try {
      events = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).send('Bad JSON');
    }
    if (!Array.isArray(events)) events = [events];

    try {
      for (const event of events) {
        if (event?.type !== 'email.received') continue; // other event types: acknowledge and ignore
        const id = event.data?.object?.id || event.object?.id;
        const key = event.event_id || id;
        if (!id || seen.has(key)) continue;
        if (String(event.event_id || '').startsWith('evt_test_')) {
          console.log('📧 Emailit test event received');
          remember(key);
          continue;
        }
        const email = await fetchEmail(id);
        const message = toInboundMessage(email);
        const fake = fakeResponse();
        await handleEmail({ body: message, headers: {}, query: {}, emailitVerified: true, get: () => undefined }, fake);
        if (fake.statusCode >= 400) console.warn(`📧 Emailit email ${id} from ${message.from} not processed (${fake.statusCode})`);
        remember(key);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('💥 Emailit webhook error (Emailit will retry):', error.message);
      res.status(500).send('Error');
    }
  };
}
