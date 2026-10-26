// Run: npm test  (node's built-in test runner; no real network: fake Zernio,
// fake Twilio media/API and fake Emailit all run on 127.0.0.1)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import twilio from 'twilio';

// The service logs a lot; keep test output readable (TEST_VERBOSE=1 shows it)
if (!process.env.TEST_VERBOSE) for (const k of ['log', 'warn', 'error']) console[k] = () => {};

const PUBLIC_BASE = 'https://text-to-attention.fly.dev';
const TOKEN = 'test-auth-token';
const DAVID = '+13473610822';
const SENDER = '+18666188109';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-state-'));

// ---------------------------------------------------------------- fakes ----
const fake = { zernio: [], uploads: [], media: [], emailit: [], emailitReads: [], inbox: {}, twilio: [], nextPost: null };
const EMAILIT_SECRET = 'whsec_' + 'ab'.repeat(32);

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

let zernio, files, emailit, app, appServer, appUrl;
let mod;

function publishedPost(postData) {
  return {
    _id: 'post_123',
    content: postData.content,
    metadata: postData.metadata,
    platforms: postData.platforms.map(p => ({
      platform: p.platform,
      accountId: p.accountId,
      status: 'published',
      platformPostUrl: `https://example.test/${p.platform}/${p.accountId}`
    }))
  };
}

before(async () => {
  zernio = await listen(async (req, res) => {
    const body = await readBody(req);
    if (req.method === 'POST' && req.url === '/media/presign') {
      const json = JSON.parse(body);
      fake.zernio.push({ path: req.url, json, auth: req.headers.authorization });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ uploadUrl: `${zernio.url}/upload/${json.filename}`, publicUrl: `https://cdn.zernio.test/${json.filename}` }));
    }
    if (req.method === 'PUT' && req.url.startsWith('/upload/')) {
      fake.uploads.push({ path: req.url, bytes: body.length, type: req.headers['content-type'] });
      res.writeHead(200); return res.end();
    }
    if (req.method === 'POST' && req.url === '/posts') {
      const json = JSON.parse(body);
      fake.zernio.push({ path: req.url, json, idempotencyKey: req.headers['idempotency-key'] });
      const post = fake.nextPost ? fake.nextPost(json) : publishedPost(json);
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ post }));
    }
    res.writeHead(404); res.end('{}');
  });

  files = await listen(async (req, res) => {
    fake.media.push({ path: req.url, auth: req.headers.authorization });
    if (req.url.startsWith('/twilio/big')) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(17 * 1024 * 1024) });
      return res.end(); // the service refuses on the header alone
    }
    if (req.url.startsWith('/twilio/') || req.url.endsWith('.mp4')) {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      return res.end(Buffer.alloc(2048, 1));
    }
    if (req.url.startsWith('/html')) {
      res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html></html>');
    }
    res.writeHead(404); res.end();
  });

  // Fake Emailit API v2: POST /emails (outbound) and GET /emails/{id} (inbound message)
  emailit = await listen(async (req, res) => {
    const body = await readBody(req);
    if (req.method === 'POST' && req.url === '/v2/emails') {
      fake.emailit.push({ path: req.url, auth: req.headers.authorization, json: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'email', id: `em_out${fake.emailit.length}`, message_id: `<out${fake.emailit.length}@attentionearned.com>`, status: 'pending' }));
    }
    const m = req.url.match(/^\/v2\/emails\/([A-Za-z0-9_]+)$/);
    if (req.method === 'GET' && m) {
      fake.emailitReads.push({ id: m[1], auth: req.headers.authorization });
      const email = fake.inbox[m[1]];
      res.writeHead(email ? 200 : 404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(email || { error: 'not_found' }));
    }
    res.writeHead(404); res.end('{}');
  });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    ZERNIO_BASE_URL: zernio.url,
    ZERNIO_API_KEY: 'zernio-test-key',
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: TOKEN,
    TWILIO_WHATSAPP_FROM: SENDER,
    PUBLIC_BASE_URL: PUBLIC_BASE,
    EMAILIT_API_KEY: 'secret_emailit_test',
    EMAILIT_API_URL: `${emailit.url}/v2`,
    EMAILIT_WEBHOOK_SECRET: EMAILIT_SECRET,
    EMAIL_FROM: 'Attention Earned <post@attentionearned.com>',
    STATE_DIR: stateDir
  });
  delete process.env.TWILIO_WA_TEMPLATE_POSTED_SID;
  delete process.env.SMS_ENABLED;
  delete process.env.TWILIO_SKIP_SIGNATURE_CHECK;
  delete process.env.ZERNIO_WEBHOOK_SECRET;

  mod = {
    channels: await import('../lib/channels.js'),
    store: await import('../lib/store.js'),
    notify: await import('../lib/notify.js'),
    links: await import('../lib/links.js'),
    keywords: await import('../lib/keywords.js')
  };
  mod.channels.setTwilioClient({
    messages: { create: async params => { fake.twilio.push(params); return { sid: `SM${fake.twilio.length}` }; } }
  });
  app = (await import('../index.js')).default;
  await new Promise(resolve => { appServer = app.listen(0, '127.0.0.1', resolve); });
  appUrl = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  for (const s of [zernio, files, emailit]) s.server.close();
  appServer.close();
  fs.rmSync(stateDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const k of ['zernio', 'uploads', 'media', 'emailit', 'emailitReads', 'twilio']) fake[k].length = 0;
  fake.inbox = {};
  delete process.env.EMAIL_WEBHOOK_SECRET;
  fake.nextPost = null;
  fs.rmSync(path.join(stateDir, 'state.json'), { force: true });
  mod.store._resetForTests();
  delete process.env.TWILIO_WA_TEMPLATE_POSTED_SID;
  delete process.env.SMS_ENABLED;
  delete process.env.ZERNIO_WEBHOOK_SECRET;
});

// ------------------------------------------------------------- helpers ----
let sid = 0;
async function postTwilio(route, params, { signature } = {}) {
  const body = { MessageSid: `SM${Date.now()}${++sid}`, NumMedia: '0', ...params };
  const sig = signature ?? twilio.getExpectedTwilioSignature(TOKEN, `${PUBLIC_BASE}${route}`, body);
  const res = await fetch(`${appUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
    body: new URLSearchParams(body).toString()
  });
  return { status: res.status, text: await res.text() };
}

function whatsapp(params, opts) {
  return postTwilio('/whatsapp-webhook', { From: `whatsapp:${DAVID}`, To: `whatsapp:${SENDER}`, ...params }, opts);
}

async function until(fn, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = fn();
    if (value) return value;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('timed out waiting');
}

const posts = () => fake.zernio.filter(z => z.path === '/posts');
const twiml = text => (text.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] || '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function signZernio(body) {
  return crypto.createHmac('sha256', process.env.ZERNIO_WEBHOOK_SECRET).update(body).digest('hex');
}

async function zernioWebhook(event) {
  process.env.ZERNIO_WEBHOOK_SECRET = 'zernio-secret';
  const body = JSON.stringify(event);
  const res = await fetch(`${appUrl}/zernio-webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-zernio-signature': signZernio(body) }, body
  });
  return res.status;
}

function scheduledEvent({ lastInboundAt, platforms }) {
  return {
    id: `evt_${Date.now()}_${++sid}`,
    event: platforms.some(p => p.status === 'failed') ? 'post.partial' : 'post.published',
    post: {
      _id: 'post_sched',
      content: 'Gala thank-you\nThank you all',
      metadata: {
        source: 'text-to-attention', replyChannel: 'whatsapp', replyTo: DAVID, replyFrom: SENDER,
        replyLastInboundAt: String(lastInboundAt), title: 'Gala thank-you', replyVia: 'webhook'
      },
      platforms
    }
  };
}

const IG_PERSONAL = '68dafe7838690b4b9b1927f4';
const LI_PERSONAL = '6949a8d84207e06f4ca82571';
const THREE_DAYS_AGO = Date.now() - 3 * 24 * 3600 * 1000;

// --------------------------------------------------------------- tests ----

test('WhatsApp video in -> Zernio post -> live links back on WhatsApp', async () => {
  const res = await whatsapp({ Body: 'Gala thank-you video', NumMedia: '1', MediaUrl0: `${files.url}/twilio/ME1`, MediaContentType0: 'video/mp4' });
  assert.equal(res.status, 200);
  assert.match(twiml(res.text), /^Attention Earned: Got it\. Posting now: /);

  const reply = await until(() => fake.twilio.find(m => m.body?.includes('Live')));
  const post = posts()[0].json;
  assert.equal(post.publishNow, true);
  assert.equal(post.content, 'Gala thank-you video');
  assert.equal(post.mediaItems[0].type, 'video');
  assert.equal(post.metadata.replyChannel, 'whatsapp');
  assert.ok(Number(post.metadata.replyLastInboundAt) > 0);
  assert.match(posts()[0].idempotencyKey, /^tta-whatsapp-SM/);
  // media fetched from Twilio with basic auth (Account SID + token)
  assert.equal(fake.media[0].auth, `Basic ${Buffer.from(`ACtest:${TOKEN}`).toString('base64')}`);
  assert.equal(fake.uploads[0].bytes, 2048);
  // reply on the same channel, from the WhatsApp sender
  assert.equal(reply.from, `whatsapp:${SENDER}`);
  assert.equal(reply.to, `whatsapp:${DAVID}`);
  assert.match(reply.body, /^Attention Earned: ✅ Live everywhere:/);
  assert.ok(reply.body.includes('https://example.test/instagram/'));
  // YouTube gets the video too (needs a video), Reddit stays off
  assert.ok(post.platforms.some(p => p.platform === 'youtube'));
  assert.ok(!post.platforms.some(p => p.platform === 'reddit'));
});

test('same commands as SMS: "post to instagram business"', async () => {
  await whatsapp({ Body: 'New reel\npost to instagram business', NumMedia: '1', MediaUrl0: `${files.url}/twilio/ME2`, MediaContentType0: 'video/mp4' });
  await until(() => fake.twilio.length > 0);
  const post = posts()[0].json;
  assert.deepEqual(post.platforms.map(p => p.accountId), ['6a8f4e0f77555aae01c8e7b9']);
  assert.equal(post.content, 'New reel');
});

test('signature: a bad or missing X-Twilio-Signature is refused, nothing posts', async () => {
  const bad = await whatsapp({ Body: 'hi', NumMedia: '1', MediaUrl0: `${files.url}/twilio/ME3`, MediaContentType0: 'video/mp4' }, { signature: 'bm90LXZhbGlk' });
  assert.equal(bad.status, 403);
  const missing = await whatsapp({ Body: 'hi' }, { signature: '' });
  assert.equal(missing.status, 403);
  // signed for a different URL
  const params = { From: `whatsapp:${DAVID}`, To: `whatsapp:${SENDER}`, Body: 'hi', MessageSid: 'SMx', NumMedia: '0' };
  const wrongUrl = await whatsapp({ Body: 'hi', MessageSid: 'SMx' }, { signature: twilio.getExpectedTwilioSignature(TOKEN, 'https://evil.example/whatsapp-webhook', params) });
  assert.equal(wrongUrl.status, 403);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(posts().length, 0);
  assert.equal(fake.twilio.length, 0);
});

test('signature: no TWILIO_AUTH_TOKEN means refuse, unless the local-test skip is on', async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  try {
    const refused = await whatsapp({ Body: 'HELP' }, { signature: 'anything' });
    assert.equal(refused.status, 403);
    process.env.TWILIO_SKIP_SIGNATURE_CHECK = 'true';
    const skipped = await whatsapp({ Body: 'HELP' }, { signature: 'anything' });
    assert.equal(skipped.status, 200);
  } finally {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    delete process.env.TWILIO_SKIP_SIGNATURE_CHECK;
  }
});

test('HELP answers with the help text, contact email and phone', async () => {
  const res = await whatsapp({ Body: 'help' });
  const text = twiml(res.text);
  assert.match(text, /^Attention Earned: /);
  assert.ok(text.includes('editors@attentionearned.com'));
  assert.ok(text.includes('347-361-0822'));
  assert.ok(text.includes('STOP'));
  assert.equal(posts().length, 0);
});

test('STOP opts out: confirmation, then nothing is posted or sent until START', async () => {
  const stop = await whatsapp({ Body: 'STOP' });
  assert.match(twiml(stop.text), /^Attention Earned: You're unsubscribed/);
  assert.equal(mod.store.isOptedOut('whatsapp', DAVID), true);

  const ignored = await whatsapp({ Body: 'post this', NumMedia: '1', MediaUrl0: `${files.url}/twilio/ME4`, MediaContentType0: 'video/mp4' });
  assert.equal(twiml(ignored.text), '');
  // a later notification (e.g. a scheduled post going live) is not sent either
  const result = await mod.notify.notify({ channel: 'whatsapp', to: DAVID, lastInboundAt: Date.now() }, 'Live: x');
  assert.equal(result.reason, 'opted_out');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(posts().length, 0);
  assert.equal(fake.twilio.length, 0);

  // survives a restart (read back from the state file)
  mod.store._resetForTests();
  assert.equal(mod.store.isOptedOut('whatsapp', DAVID), true);

  const start = await whatsapp({ Body: 'Start' });
  assert.match(twiml(start.text), /^Attention Earned: You're signed up/);
  assert.equal(mod.store.isOptedOut('whatsapp', DAVID), false);
});

test('24h window closed + template configured: live links go as the approved template', async () => {
  process.env.TWILIO_WA_TEMPLATE_POSTED_SID = 'HXtemplate123';
  const status = await zernioWebhook(scheduledEvent({
    lastInboundAt: THREE_DAYS_AGO,
    platforms: [
      { platform: 'instagram', accountId: IG_PERSONAL, status: 'published', publishedUrl: 'https://instagram.com/p/abc' },
      { platform: 'linkedin', accountId: LI_PERSONAL, status: 'published', publishedUrl: 'https://linkedin.com/feed/update/1' }
    ]
  }));
  assert.equal(status, 200);
  await until(() => fake.twilio.length === 2);
  for (const m of fake.twilio) {
    assert.equal(m.contentSid, 'HXtemplate123');
    assert.equal(m.body, undefined);
    assert.equal(m.from, `whatsapp:${SENDER}`);
    assert.equal(m.to, `whatsapp:${DAVID}`);
  }
  assert.deepEqual(JSON.parse(fake.twilio[0].contentVariables), { 1: '"Gala thank-you" on IG @dovid_chait', 2: 'https://instagram.com/p/abc' });
  assert.equal(fake.emailit.length, 0); // nothing failed, so no email needed
});

test('24h window closed + no template: falls back to email (not SMS)', async () => {
  await zernioWebhook(scheduledEvent({
    lastInboundAt: THREE_DAYS_AGO,
    platforms: [{ platform: 'instagram', accountId: IG_PERSONAL, status: 'published', publishedUrl: 'https://instagram.com/p/abc' }]
  }));
  const mail = await until(() => fake.emailit[0]);
  assert.equal(mail.auth, 'Bearer secret_emailit_test');
  assert.equal(mail.json.to, 'chaitd@outlook.com');
  assert.equal(mail.json.from, 'Attention Earned <post@attentionearned.com>');
  assert.match(mail.json.subject, /^Attention Earned: /);
  assert.ok(mail.json.text.includes('https://instagram.com/p/abc'));
  assert.equal(fake.twilio.length, 0); // no WhatsApp free-form, and SMS is off
});

test('24h window closed with a failure: template for the live link, email for the failure', async () => {
  process.env.TWILIO_WA_TEMPLATE_POSTED_SID = 'HXtemplate123';
  await zernioWebhook(scheduledEvent({
    lastInboundAt: THREE_DAYS_AGO,
    platforms: [
      { platform: 'instagram', accountId: IG_PERSONAL, status: 'published', publishedUrl: 'https://instagram.com/p/abc' },
      { platform: 'linkedin', accountId: LI_PERSONAL, status: 'failed', error: 'video too long' }
    ]
  }));
  await until(() => fake.emailit.length === 1 && fake.twilio.length === 1);
  assert.equal(fake.twilio[0].contentSid, 'HXtemplate123');
  assert.ok(fake.emailit[0].json.text.includes('video too long'));
});

test('24h window closed, SMS only when SMS_ENABLED=true and email is not available', async () => {
  process.env.SMS_ENABLED = 'true';
  process.env.TWILIO_FROM_NUMBER = SENDER;
  mod.store.setOptedOut('email', 'chaitd@outlook.com', true);
  await zernioWebhook(scheduledEvent({
    lastInboundAt: THREE_DAYS_AGO,
    platforms: [{ platform: 'instagram', accountId: IG_PERSONAL, status: 'published', publishedUrl: 'https://instagram.com/p/abc' }]
  }));
  const sms = await until(() => fake.twilio[0]);
  assert.equal(sms.to, DAVID);
  assert.match(sms.body, /^Attention Earned: /);
  assert.equal(fake.emailit.length, 0);
});

test('inside the 24h window a scheduled post reports free-form on WhatsApp', async () => {
  process.env.TWILIO_WA_TEMPLATE_POSTED_SID = 'HXtemplate123';
  await zernioWebhook(scheduledEvent({
    lastInboundAt: Date.now() - 2 * 3600 * 1000,
    platforms: [{ platform: 'instagram', accountId: IG_PERSONAL, status: 'published', publishedUrl: 'https://instagram.com/p/abc' }]
  }));
  const m = await until(() => fake.twilio[0]);
  assert.equal(m.contentSid, undefined);
  assert.match(m.body, /^Attention Earned: ✅ Live everywhere:\nIG @dovid_chait: https:\/\/instagram\.com\/p\/abc/);
});

test('a later WhatsApp message re-opens the window (state file beats the time saved on the post)', async () => {
  mod.store.recordInbound('whatsapp', DAVID, Date.now() - 3600 * 1000);
  assert.equal(mod.notify.insideWhatsAppWindow({ channel: 'whatsapp', to: DAVID, lastInboundAt: THREE_DAYS_AGO }), true);
  assert.equal(mod.notify.insideWhatsAppWindow({ channel: 'whatsapp', to: '+15550001111', lastInboundAt: THREE_DAYS_AGO }), false);
});

test('WhatsApp video over 16 MB: tells them to send a link', async () => {
  await whatsapp({ Body: 'big one', NumMedia: '1', MediaUrl0: `${files.url}/twilio/big`, MediaContentType0: 'video/mp4' });
  const m = await until(() => fake.twilio[0]);
  assert.match(m.body, /^Attention Earned: ❌ Post failed:/);
  assert.ok(m.body.includes('too big for WhatsApp'));
  assert.ok(m.body.includes('Dropbox or Google Drive link'));
  assert.equal(posts().length, 0);
});

test('empty WhatsApp message (e.g. a file WhatsApp would not pass) gets the link hint', async () => {
  const res = await whatsapp({ Body: '' });
  assert.ok(twiml(res.text).includes('Dropbox or Google Drive link'));
});

test('a video link in the text is used as the media and left out of the caption', async () => {
  const link = `${files.url}/clips/gala.mp4`;
  await whatsapp({ Body: `Gala recap ${link}\npost to linkedin personal` });
  await until(() => fake.twilio.length > 0);
  const post = posts()[0].json;
  assert.equal(post.content, 'Gala recap');
  assert.equal(post.mediaItems.length, 1);
  assert.ok(fake.media.some(m => m.path === '/clips/gala.mp4' && !m.auth)); // no Twilio credentials sent to other hosts
  assert.deepEqual(post.platforms.map(p => p.accountId), [LI_PERSONAL]);
});

test('a link that is a web page, not a file, fails with a clear reason', async () => {
  await assert.rejects(mod.links.downloadLink(`${files.url}/html/page`), /web page, not the file/);
});

test('share links become direct downloads', () => {
  assert.equal(mod.links.directDownloadUrl('https://www.dropbox.com/scl/fi/abc/gala.mp4?rlkey=x&dl=0'), 'https://www.dropbox.com/scl/fi/abc/gala.mp4?rlkey=x&dl=1');
  assert.equal(mod.links.directDownloadUrl('https://drive.google.com/file/d/1AbC_d/view?usp=sharing'), 'https://drive.usercontent.google.com/download?id=1AbC_d&export=download&confirm=t');
  assert.deepEqual(mod.links.findMediaLinks('see https://www.dropbox.com/s/x/a.mov?dl=0. and https://attentionearned.com/about'), ['https://www.dropbox.com/s/x/a.mov?dl=0']);
});

// ---------------------------------------------------------------- email ----
let evt = 0;
function inboundEmail(id, overrides = {}) {
  return {
    object: 'email', id, type: 'inbound', status: 'received',
    from: 'chaitd@outlook.com',
    to: 'post@inbound.attentionearned.com',
    subject: 'Shiur clip',
    message_id: '<abc@outlook.com>',
    headers: { 'From': 'David Chait <chaitd@outlook.com>', 'Message-ID': '<abc@outlook.com>', 'Authentication-Results': 'mx.emailit.com; spf=pass smtp.mailfrom=outlook.com; dkim=pass header.d=outlook.com; dmarc=pass' },
    body: { text: 'Shiur clip\npost to linkedin', html: '<p>Shiur clip</p>' },
    attachments: [{ filename: 'clip.mp4', content_type: 'video/mp4', size: 4096, content_id: null, content_disposition: 'attachment', content: Buffer.alloc(4096, 2).toString('base64') }],
    ...overrides
  };
}

async function emailitWebhook(events, { secret = EMAILIT_SECRET, timestamp, signature } = {}) {
  const raw = JSON.stringify(events);
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const sig = signature ?? crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const res = await fetch(`${appUrl}/email-webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-emailit-signature': sig, 'x-emailit-timestamp': String(ts) },
    body: raw
  });
  return { status: res.status, text: await res.text() };
}

function received(id) {
  return { event_id: `evt_${Date.now()}${++evt}`, type: 'email.received', object: { id, object: 'email' }, data: { object: { id, object: 'email', from: 'chaitd@outlook.com', to: 'post@inbound.attentionearned.com' } } };
}

test('email in (Emailit webhook, video attachment) -> post -> threaded email reply with live links', async () => {
  fake.inbox.em_in1 = inboundEmail('em_in1');
  const res = await emailitWebhook([received('em_in1')]);
  assert.equal(res.status, 200);
  assert.equal(fake.emailitReads[0].auth, 'Bearer secret_emailit_test');
  const live = await until(() => fake.emailit.find(m => m.json.text.includes('Live')));
  const gotIt = fake.emailit.find(m => m.json.text.includes('Got it'));
  assert.ok(gotIt, 'sends a "Got it" email');
  assert.match(gotIt.json.text, /^Attention Earned: Got it\./);
  assert.equal(live.json.to, 'chaitd@outlook.com');
  assert.equal(live.json.from, 'Attention Earned <post@attentionearned.com>');
  assert.equal(live.json.subject, 'Re: Shiur clip');
  assert.equal(live.json.headers['In-Reply-To'], '<abc@outlook.com>');
  assert.match(live.json.headers.References, /<abc@outlook\.com>/);
  assert.equal(live.json.reply_to, 'post@inbound.attentionearned.com'); // replies come back to Emailit
  assert.equal(live.json.tracking, false);
  const post = posts()[0].json;
  assert.equal(post.content, 'Shiur clip');
  assert.equal(post.metadata.replyChannel, 'email');
  assert.equal(post.metadata.replySubject, 'Shiur clip');
  assert.equal(fake.uploads[0].bytes, 4096);
  assert.deepEqual(post.platforms.map(p => p.platform), ['linkedin', 'linkedin']);
});

test('Emailit webhook: a batch posts each email once, retries are skipped, other events ignored', async () => {
  fake.inbox.em_b1 = inboundEmail('em_b1', { subject: 'One', body: { text: 'One\npost to linkedin personal' } });
  fake.inbox.em_b2 = inboundEmail('em_b2', { subject: 'Two', message_id: '<two@outlook.com>', body: { text: 'Two\npost to linkedin personal' } });
  const batch = [received('em_b1'), { event_id: 'evt_x', type: 'email.delivered', data: { object: { id: 'em_out' } } }, received('em_b2')];
  assert.equal((await emailitWebhook(batch)).status, 200);
  await until(() => posts().length === 2);
  assert.equal((await emailitWebhook(batch)).status, 200); // Emailit retrying the same batch
  await new Promise(r => setTimeout(r, 150));
  assert.equal(posts().length, 2);
  assert.deepEqual(posts().map(p => p.json.content).sort(), ['One', 'Two']);
});

test('Emailit webhook: bad or stale signature, or no secret configured, is refused', async () => {
  fake.inbox.em_sig = inboundEmail('em_sig');
  assert.equal((await emailitWebhook([received('em_sig')], { secret: 'whsec_wrong' })).status, 401);
  assert.equal((await emailitWebhook([received('em_sig')], { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  const saved = process.env.EMAILIT_WEBHOOK_SECRET;
  delete process.env.EMAILIT_WEBHOOK_SECRET;
  try {
    assert.equal((await emailitWebhook([received('em_sig')], { secret: saved })).status, 401);
  } finally {
    process.env.EMAILIT_WEBHOOK_SECRET = saved;
  }
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fake.emailitReads.length, 0);
  assert.equal(posts().length, 0);
});

test('Emailit API error while fetching the email -> 500 so Emailit retries', async () => {
  const res = await emailitWebhook([received('em_missing')]);
  assert.equal(res.status, 500);
  assert.equal(posts().length, 0);
});

test('email that fails SPF/DKIM/DMARC (forged From) is refused', async () => {
  fake.inbox.em_forged = inboundEmail('em_forged', {
    headers: { 'From': 'chaitd@outlook.com', 'Authentication-Results': 'mx.emailit.com; spf=fail smtp.mailfrom=outlook.com; dkim=none; dmarc=fail' }
  });
  assert.equal((await emailitWebhook([received('em_forged')])).status, 200); // acknowledged so Emailit doesn't retry
  await new Promise(r => setTimeout(r, 150));
  assert.equal(posts().length, 0);
  assert.equal(fake.emailit.length, 0);
});

test('email from an unknown address gets no reply (no backscatter) and posts nothing', async () => {
  fake.inbox.em_stranger = inboundEmail('em_stranger', { from: 'stranger@example.com', headers: { From: 'stranger@example.com' } });
  await emailitWebhook([received('em_stranger')]);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(fake.emailit.length, 0);
  assert.equal(posts().length, 0);
});

test('stale ALLOWED_SENDERS / ALLOWED_WHATSAPP_NUMBERS do not block people in users.json', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { ALLOWED_SENDERS: 'someone-else@example.com', ALLOWED_WHATSAPP_NUMBERS: '+15550000000' });
  try {
    fake.inbox.em_stale = inboundEmail('em_stale');
    assert.equal((await emailitWebhook([received('em_stale')])).status, 200);
    await until(() => posts().length === 1);
    await until(() => fake.emailit.find(m => m.json.text.includes('Got it')));
  } finally {
    for (const k of ['ALLOWED_SENDERS', 'ALLOWED_WHATSAPP_NUMBERS', 'ENFORCE_ENV_ALLOWLIST']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

test('ENFORCE_ENV_ALLOWLIST=true: env lists are an extra filter, compared by address/number', async () => {
  const { allowedByEnv } = await import('../lib/poster.js');
  try {
    process.env.ENFORCE_ENV_ALLOWLIST = 'true';
    process.env.ALLOWED_SENDERS = ' "Chaitd@Outlook.com" , other@example.com';
    process.env.ALLOWED_WHATSAPP_NUMBERS = '+1 (347) 361-0822';
    assert.equal(allowedByEnv('email', 'David Chait <chaitd@outlook.com>'), true);
    assert.equal(allowedByEnv('email', 'stranger@example.com'), false);
    assert.equal(allowedByEnv('whatsapp', `whatsapp:${DAVID}`), true);
    assert.equal(allowedByEnv('whatsapp', 'whatsapp:+15550000000'), false);
    process.env.ALLOWED_SENDERS = 'someone-else@example.com';
    fake.inbox.em_enf = inboundEmail('em_enf');
    await emailitWebhook([received('em_enf')]);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(posts().length, 0);
    delete process.env.ENFORCE_ENV_ALLOWLIST;
    assert.equal(allowedByEnv('email', 'stranger@example.com'), true); // not enforced: users.json alone decides
  } finally {
    for (const k of ['ALLOWED_SENDERS', 'ALLOWED_WHATSAPP_NUMBERS', 'ENFORCE_ENV_ALLOWLIST']) delete process.env[k];
  }
});

test('EMAIL_FROM / EMAIL_REPLY_TO saved with quotes or junk still send from a valid address', async () => {
  const { normalizeAddress, cleanEnvString } = await import('../lib/emailit.js');
  assert.equal(cleanEnvString(' "Attention Earned <post@attentionearned.com>" '), 'Attention Earned <post@attentionearned.com>');
  assert.equal(normalizeAddress("'post@attentionearned.com'"), 'post@attentionearned.com');
  assert.equal(normalizeAddress('"Attention Earned" <post@attentionearned.com>'), 'Attention Earned <post@attentionearned.com>');
  assert.equal(normalizeAddress('\u201CAttention Earned <post@attentionearned.com>\u201D'), 'Attention Earned <post@attentionearned.com>');
  assert.equal(normalizeAddress('Attention Earned'), null);
  assert.equal(normalizeAddress('a@b.com, c@d.com'), null);

  const savedFrom = process.env.EMAIL_FROM;
  try {
    process.env.EMAIL_FROM = '"Attention Earned <post@attentionearned.com>"';
    process.env.EMAIL_REPLY_TO = '"post@inbound.attentionearned.com"';
    fake.inbox.em_q1 = inboundEmail('em_q1');
    await emailitWebhook([received('em_q1')]);
    const gotIt = await until(() => fake.emailit.find(m => m.json.text.includes('Got it')));
    assert.equal(gotIt.json.from, 'Attention Earned <post@attentionearned.com>');
    assert.equal(gotIt.json.reply_to, 'post@inbound.attentionearned.com');

    fake.emailit.length = 0;
    process.env.EMAIL_FROM = 'not an address';
    process.env.EMAIL_REPLY_TO = 'nope';
    fake.inbox.em_q2 = inboundEmail('em_q2', { message_id: '<q2@outlook.com>' });
    await emailitWebhook([received('em_q2')]);
    const gotIt2 = await until(() => fake.emailit.find(m => m.json.text.includes('Got it')));
    assert.equal(gotIt2.json.from, 'Attention Earned <post@attentionearned.com>'); // DEFAULT_FROM
    assert.equal(gotIt2.json.reply_to, 'post@inbound.attentionearned.com'); // falls back to the inbound address
  } finally {
    process.env.EMAIL_FROM = savedFrom;
    delete process.env.EMAIL_REPLY_TO;
  }
});

test('email STOP in a reply (quoted thread below) opts out of email', async () => {
  fake.inbox.em_stop = inboundEmail('em_stop', {
    subject: 'Re: Attention Earned: Got it',
    body: { text: 'STOP\n\nOn Mon, Oct 26, 2026 at 1:40 PM Attention Earned <post@attentionearned.com> wrote:\n> Attention Earned: Got it. Posting now' },
    attachments: []
  });
  await emailitWebhook([received('em_stop')]);
  await until(() => mod.store.isOptedOut('email', 'chaitd@outlook.com'));
  const reply = await until(() => fake.emailit[0]);
  assert.match(reply.json.text, /^Attention Earned: /);
  assert.equal(posts().length, 0);
});

test('other forwarders (no Emailit signature) need EMAIL_WEBHOOK_SECRET', async () => {
  const body = JSON.stringify({ from: 'chaitd@outlook.com', subject: 'hi', text: 'Forwarded\npost to linkedin personal', attachments: [] });
  const refused = await fetch(`${appUrl}/email-webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(refused.status, 403);
  process.env.EMAIL_WEBHOOK_SECRET = 'fwd-secret';
  const wrong = await fetch(`${appUrl}/email-webhook?secret=nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(wrong.status, 403);
  const ok = await fetch(`${appUrl}/email-webhook?secret=fwd-secret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(ok.status, 200);
  await until(() => posts().length === 1);
  assert.equal(posts()[0].json.content, 'Forwarded');
});

test('quoted reply text is stripped', () => {
  const { stripQuotedReply } = mod.channels;
  assert.equal(stripQuotedReply('New caption\n\nOn Mon, Oct 26, 2026 at 1:40 PM\nAttention Earned <post@attentionearned.com> wrote:\n> old'), 'New caption');
  assert.equal(stripQuotedReply('Hi\n-----Original Message-----\nFrom: x'), 'Hi');
  assert.equal(stripQuotedReply('line one\nline two'), 'line one\nline two');
});

test('SMS is off unless SMS_ENABLED=true; when on, replies start with "Attention Earned:"', async () => {
  const off = await postTwilio('/sms-webhook', { From: DAVID, To: SENDER, Body: 'hello', NumMedia: '1', MediaUrl0: `${files.url}/twilio/ME9`, MediaContentType0: 'video/mp4' });
  assert.equal(twiml(off.text), '');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(posts().length, 0);

  process.env.SMS_ENABLED = 'true';
  const on = await postTwilio('/sms-webhook', { From: DAVID, To: SENDER, Body: 'hello\npost to linkedin personal' });
  assert.match(twiml(on.text), /^Attention Earned: Got it\./);
  const reply = await until(() => fake.twilio[0]);
  assert.match(reply.body, /^Attention Earned: /);
  assert.equal(reply.to, DAVID);
});

test('SMS STOP is recorded but not answered (Twilio Opt-Out Management replies)', async () => {
  process.env.SMS_ENABLED = 'true';
  const res = await postTwilio('/sms-webhook', { From: DAVID, To: SENDER, Body: 'STOP' });
  assert.equal(twiml(res.text), '');
  assert.equal(mod.store.isOptedOut('sms', DAVID), true);
});

test('keywords only match the whole message', () => {
  assert.equal(mod.keywords.keywordOf(' stop. '), 'stop');
  assert.equal(mod.keywords.keywordOf('JOIN'), 'start');
  assert.equal(mod.keywords.keywordOf('Info'), 'help');
  assert.equal(mod.keywords.keywordOf("don't stop posting"), null);
});

test('health check shows configuration flags only, never values', async () => {
  const res = await fetch(`${appUrl}/`);
  const json = await res.json();
  assert.equal(json.config.whatsappSender, true);
  assert.ok(!JSON.stringify(json).includes(TOKEN));
});
