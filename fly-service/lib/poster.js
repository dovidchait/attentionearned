import crypto from 'crypto';
import { uploadMedia, createPost, waitForPost, isInFlight, platformResults } from './zernio.js';
import { parseCommand, stripCommands, selectTargets } from './commands.js';
import { findUser, apiKeyFor, accountLabels, extractEmail, normalizePhone } from './users.js';
import { smsEnabled } from './channels.js';
import { notify, brand } from './notify.js';
import { keywordOf, KEYWORD_REPLIES } from './keywords.js';
import { findMediaLinks, removeLinks, guessContentType, downloadLink } from './links.js';
import * as store from './store.js';
import { resolveStyle, processVideo, ffmpegAvailable } from './subtitles.js';

// ============================================================================
// POSTING PIPELINE (channel-agnostic)
// inbound message -> user -> media upload -> Zernio post -> "where it went" reply
// ============================================================================

const ALLOWLISTS = {
  sms: 'ALLOWED_NUMBERS',
  whatsapp: 'ALLOWED_WHATSAPP_NUMBERS',
  email: 'ALLOWED_SENDERS'
};

const BIG_VIDEO_HINT = 'For videos over 16 MB, send a Dropbox or Google Drive link in your message instead.';

// users.json is the allowlist: a sender must be in it to post. The ALLOWED_*
// env lists are an optional EXTRA filter, only used when
// ENFORCE_ENV_ALLOWLIST=true (old values left in Fly secrets used to silently
// block people who are in users.json).
function envAllowlistEnforced() {
  return String(process.env.ENFORCE_ENV_ALLOWLIST || '').trim().replace(/^["']|["']$/g, '').toLowerCase() === 'true';
}

function senderKey(channelName, value) {
  const s = String(value || '').trim().replace(/^["']|["']$/g, '');
  return channelName === 'email' ? extractEmail(s) : normalizePhone(s);
}

export function allowedByEnv(channelName, sender) {
  if (!envAllowlistEnforced()) return true;
  const list = (process.env[ALLOWLISTS[channelName]] || '').split(',').map(s => senderKey(channelName, s)).filter(Boolean);
  return list.length === 0 || list.includes(senderKey(channelName, sender));
}

{
  const setLists = Object.values(ALLOWLISTS).filter(name => String(process.env[name] || '').trim());
  if (setLists.length && !envAllowlistEnforced()) {
    console.log(`ℹ️  ${setLists.join(', ')} set but not used (users.json decides who can post; set ENFORCE_ENV_ALLOWLIST=true to also require them)`);
  }
}

/**
 * Express handler factory: app.post('/whatsapp-webhook', inboundHandler(channels.whatsapp))
 * Answers the webhook immediately (Twilio gives us 15s), then posts in the
 * background and sends the result on the same channel.
 */
export function inboundHandler(channel) {
  return async (req, res) => {
    let route;
    let user = null;
    let message = null;
    const isTwilio = channel.name !== 'email';

    // Twilio channels answer inside the webhook response (TwiML). Email's webhook
    // response reaches nobody, so email answers by sending an email, and only to
    // people in users.json (never to unknown senders).
    const answer = (text, { toStranger = false } = {}) => {
      if (isTwilio || !text) return channel.ack(res, text ? brand(text) : '');
      channel.ack(res, text);
      if (message?.from && (user || toStranger)) {
        channel.send({ channel: 'email', to: message.from, from: message.to, inReplyTo: message.messageId, references: message.references, subject: message.subject }, brand(text))
          .catch(error => console.error('❌ Email answer failed:', error.message));
      }
    };

    try {
      if (!channel.verify(req)) {
        console.error(`Invalid ${channel.name} webhook signature`);
        return res.status(403).send('Forbidden');
      }
      if (channel.name === 'sms' && !smsEnabled()) {
        console.log('📵 SMS is off (SMS_ENABLED is not true); ignoring inbound SMS');
        return channel.ack(res, '');
      }

      message = await channel.parse(req);
      console.log(`📨 ${channel.name} from ${message.from} with ${message.media.length} media`);
      if (!message.from) return channel.ack(res, '');
      store.recordInbound(channel.name, message.from);
      user = findUser(channel.name, message.from);

      // STOP / START / HELP
      const keyword = keywordOf(message.text) || (channel.name === 'email' && message.media.length === 0
        ? keywordOf(message.subject) || keywordOf(message.text.split('\n')[0])
        : null);
      if (keyword) return handleKeyword(channel, message, keyword, answer, user);

      if (store.isOptedOut(channel.name, message.from)) {
        console.log(`🔕 ${message.from} is opted out of ${channel.name}; ignoring until they send START`);
        return channel.ack(res, '');
      }

      if (!user || !allowedByEnv(channel.name, message.from)) {
        console.log(user
          ? `🚫 ${channel.name} sender ${message.from} is in users.json (${user.name}) but not in ${ALLOWLISTS[channel.name]} (ENFORCE_ENV_ALLOWLIST=true)`
          : `🚫 ${channel.name} sender ${message.from} is not in users.json`);
        return answer('Sorry, this number or address is not set up to post. Contact editors@attentionearned.com.');
      }
      if (!apiKeyFor(user)) {
        console.error(`No Zernio key in env ${user.apiKeyEnv || 'ZERNIO_API_KEY'} for ${user.name}`);
        return answer('Posting is not configured yet (missing Zernio key).');
      }

      route = {
        channel: channel.name,
        to: message.from,
        from: message.to,
        lastInboundAt: Date.now(),
        inReplyTo: channel.name === 'email' ? message.messageId : undefined,
        references: channel.name === 'email' ? message.references || undefined : undefined,
        subject: channel.name === 'email' ? message.subject || undefined : undefined
      };

      // A Dropbox / Drive / direct file link in the text counts as media
      const links = findMediaLinks(`${message.text}\n${message.subject}`);
      const text = removeLinks(message.text, links);
      const subject = removeLinks(message.subject, links);
      const media = [
        ...message.media,
        ...links.map((url, i) => ({ link: url, contentType: guessContentType(url), index: message.media.length + i }))
      ];

      const command = parseCommand(subject, text, user.timezone || 'America/New_York');
      const caption = stripCommands(text) || stripCommands(subject);
      const mediaTypes = media.map(m => (m.contentType.startsWith('video/') ? 'video' : 'image'));

      if (media.length === 0 && !caption) {
        return answer(channel.name === 'whatsapp'
          ? `I didn't get a video or photo. WhatsApp only passes files up to 16 MB. ${BIG_VIDEO_HINT.replace('For videos over 16 MB, s', 'S')} Reply HELP for help.`
          : 'Send a video or photo with your caption to post it. Reply HELP for help.');
      }

      const { targets, skipped } = selectTargets(user, command, { caption, mediaTypes });
      if (targets.length === 0) {
        const lines = ['Nothing to post to.', ...skipped.map(s => `${s.label}: ${s.reason}`)];
        if (media.length === 0 && channel.name === 'whatsapp') lines.push(BIG_VIDEO_HINT);
        return answer(lines.join('\n'));
      }

      const names = targets.map(t => t.account.label || t.account.platform).join(', ');
      const when = command.publishingMode === 'schedule' ? `Scheduling for ${command.scheduledFor} (${command.timezone})`
        : command.publishingMode === 'queue' ? 'Adding to your queue'
        : 'Posting now';
      answer(`Got it. ${when}: ${names}. I'll send the links when they're live.`);

      // Background: the webhook has been answered
      publish({ channel, message: { ...message, media }, user, command, caption, targets, skipped, route }).catch(async error => {
        console.error('💥 Publish error:', error);
        await safeReply(route, `❌ Post failed: ${error.message}`);
      });
    } catch (error) {
      console.error(`💥 Error processing ${channel.name} message:`, error);
      if (!res.headersSent) answer('❌ Error posting. Please try again.');
      else if (route) await safeReply(route, `❌ Post failed: ${error.message}`);
    }
  };
}

function handleKeyword(channel, message, keyword, answer, user) {
  if (keyword === 'stop') store.setOptedOut(channel.name, message.from, true);
  if (keyword === 'start') store.setOptedOut(channel.name, message.from, false);
  console.log(`🔑 ${keyword.toUpperCase()} from ${message.from} on ${channel.name}`);
  // On SMS, Twilio's own Opt-Out Management sends the STOP/START/HELP replies
  // (and blocks texts after STOP), so we only record it.
  if (channel.name === 'sms') return answer('');
  return answer(KEYWORD_REPLIES[keyword]);
}

function friendlyMediaError(error, channel) {
  if (/^over \d+ MB/.test(error.message)) {
    return `too big for ${channel.name === 'whatsapp' ? 'WhatsApp' : channel.name} (${error.message}). Send a Dropbox or Google Drive link instead`;
  }
  return `couldn't upload (${error.message})`;
}

async function publish({ channel, message, user, command, caption, targets, skipped, route }) {
  const apiKey = apiKeyFor(user);

  // 0. Subtitles: decide whether to burn in
  // command.subtitles: true = on, false = off, null = use user default
  const subtitlesOn = command.subtitles ?? Boolean(user.subtitles?.enabled);
  let subtitlePreview = null; // Buffer; wire approval flow later

  // 1. Media -> Zernio storage (attachments and links)
  const mediaItems = [];
  for (const item of message.media) {
    const label = item.link ? 'Link' : `Attachment ${item.index + 1}`;
    try {
      let file = item.link ? await downloadLink(item.link) : await channel.downloadMedia(item);
      if (subtitlesOn && file.contentType.startsWith('video/') && process.env.OPENAI_API_KEY) {
        try {
          const hasffmpeg = await ffmpegAvailable();
          if (hasffmpeg) {
            const aspectRatio = guessAspectRatio(file.buffer, file.contentType);
            const style = resolveStyle(user.subtitles?.style, aspectRatio);
            const result = await processVideo(file.buffer, file.contentType, {
              style,
              vocabulary: user.subtitles?.vocabulary || [],
              aspectRatio,
              filename: file.filename
            });
            file = { ...file, buffer: result.videoBuffer };
            if (!subtitlePreview) subtitlePreview = result.previewBuffer;
            console.log(`🎬 Subtitles burned into ${label}`);
          } else {
            console.warn('⚠️  ffmpeg not found; skipping subtitle burn-in');
          }
        } catch (subErr) {
          console.error(`⚠️  Subtitle error for ${label}: ${subErr.message} — posting original`);
        }
      }
      mediaItems.push(await uploadMedia(file.buffer, file.contentType, file.filename, apiKey));
    } catch (error) {
      console.error(`   ❌ Failed media ${item.index}:`, error.message);
      skipped.push({ label, reason: item.link ? error.message : friendlyMediaError(error, channel) });
    }
  }
  if (message.media.length > 0 && mediaItems.length === 0) {
    throw new Error(`none of the media could be used. ${skipped.filter(s => /^(Link|Attachment)/.test(s.label)).map(s => `${s.label}: ${s.reason}`).join('; ')}`.trim());
  }

  // 2. Build the post
  const title = titleOf(caption);
  const postData = {
    content: caption || (mediaItems.length > 0 ? '📸' : ''),
    platforms: targets.map(t => {
      const entry = { platform: t.account.platform, accountId: t.account.accountId };
      if (Object.keys(t.platformSpecificData).length > 0) entry.platformSpecificData = t.platformSpecificData;
      return entry;
    }),
    // Echoed back on every Zernio webhook, so the reply route survives restarts
    metadata: {
      source: 'text-to-attention',
      replyChannel: route.channel,
      replyTo: route.to,
      replyFrom: route.from || '',
      // when the person last wrote in (WhatsApp 24h rule) and the email to thread under
      replyLastInboundAt: String(route.lastInboundAt || ''),
      replyRef: route.inReplyTo || '',
      replySubject: (route.subject || '').slice(0, 150),
      title,
      // 'inline' = this process reports the result itself; 'webhook' = /zernio-webhook does
      replyVia: command.publishingMode === 'now' ? 'inline' : 'webhook'
    }
  };
  if (mediaItems.length > 0) postData.mediaItems = mediaItems;

  if (command.publishingMode === 'schedule') {
    postData.scheduledFor = command.scheduledFor;
    postData.timezone = command.timezone;
  } else if (command.publishingMode === 'queue' && user.zernioProfileId) {
    postData.queuedFromProfile = user.zernioProfileId;
  } else {
    postData.publishNow = true;
  }

  // 3. Create (the inbound message id doubles as the idempotency key: a Twilio retry never double-posts)
  const idempotencyKey = message.messageId ? `tta-${channel.name}-${message.messageId}` : undefined;
  const { httpStatus, body } = await createPost(postData, apiKey, idempotencyKey);
  const labels = accountLabels(user);

  if (httpStatus === 409) {
    return safeReply(route, `Already posted this in the last 24 hours, so I didn't post it again.${body.existingPostId ? ` (post ${body.existingPostId})` : ''}`);
  }
  if (httpStatus >= 400 || !body.post) {
    throw new Error(body.error || `Zernio answered ${httpStatus}`);
  }

  let post = body.post;
  if (!postData.publishNow) {
    const whenText = command.publishingMode === 'queue' ? 'Added to your queue' : `Scheduled for ${command.scheduledFor} (${command.timezone})`;
    const lines = [`🗓️ ${whenText}: ${targets.map(t => t.account.label || t.account.platform).join(', ')}.`];
    if (process.env.ZERNIO_WEBHOOK_SECRET) lines.push("I'll send the links when it goes live.");
    lines.push(...skippedLines(skipped));
    return safeReply(route, lines.join('\n'));
  }

  // 4. Published inline. 201 = done, 207 = partial/failed/retrying (207 is a 2xx, so branch on it).
  //    Video can still be processing on some platforms: tell them, wait, then report once.
  if (isInFlight(post)) {
    const processing = platformResults(post, labels).filter(r => !['published', 'failed', 'cancelled'].includes(r.status));
    if (processing.length > 0 && processing.length === post.platforms.length) {
      await safeReply(route, `⏳ Uploaded. ${processing.map(r => r.label).join(', ')} still processing the video, I'll send the links when they're live.`);
    }
    post = await waitForPost(post._id, apiKey);
  }
  await safeReply(route, whereItWent(platformResults(post, labels), skipped, title));
}

/**
 * Quick aspect-ratio guess: probe ffprobe if available, otherwise default to
 * landscape. Portrait = width < height.
 */
async function guessAspectRatio(buffer, contentType) {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { writeFileSync, rmSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const execFileAsync = promisify(execFile);
    const tmpDir = mkdtempSync(join(tmpdir(), 'tta-ar-'));
    const ext = contentType.includes('quicktime') ? '.mov' : '.mp4';
    const tmpFile = join(tmpDir, `v${ext}`);
    writeFileSync(tmpFile, buffer);
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', tmpFile]);
    rmSync(tmpDir, { recursive: true, force: true });
    const vs = JSON.parse(stdout).streams.find(s => s.codec_type === 'video');
    return (vs && vs.width < vs.height) ? 'portrait' : 'landscape';
  } catch {
    return 'landscape';
  }
}

function titleOf(caption = '') {
  const first = String(caption).split('\n').find(l => l.trim())?.trim() || '';
  return first.length > 60 ? `${first.slice(0, 57)}...` : first;
}

/** The "where it went" message, plus the links on their own (for WhatsApp templates). */
export function whereItWent(results, skipped = [], title = '') {
  const live = results.filter(r => r.status === 'published' && r.url);
  const problems = results.some(r => r.status !== 'published' || !r.url) || (skipped && skipped.length > 0);
  return {
    text: formatWhereItWent(results, skipped),
    links: live.map(r => ({ label: r.label, url: r.url })),
    title,
    complete: !problems
  };
}

/** The "where it went" text: live links, failures with the reason, anything still processing. */
export function formatWhereItWent(results, skipped = []) {
  const live = results.filter(r => r.status === 'published');
  const failed = results.filter(r => ['failed', 'cancelled'].includes(r.status));
  const pending = results.filter(r => !['published', 'failed', 'cancelled'].includes(r.status));

  const lines = [];
  if (live.length > 0) {
    lines.push(failed.length === 0 && pending.length === 0 ? '✅ Live everywhere:' : '✅ Live:');
    for (const r of live) lines.push(`${r.label}: ${r.url || 'posted (link not ready yet)'}`);
  }
  if (failed.length > 0) {
    lines.push(live.length > 0 ? '' : '❌ Post failed:');
    if (live.length > 0) lines.push('❌ Failed:');
    for (const r of failed) lines.push(`${r.label}: ${r.error || 'no reason given'}`);
  }
  if (pending.length > 0) {
    lines.push('', '⏳ Still processing:');
    for (const r of pending) lines.push(`${r.label} (${r.status})`);
  }
  lines.push(...skippedLines(skipped));
  return lines.filter((line, i, all) => !(line === '' && (i === 0 || all[i - 1] === ''))).join('\n').trim();
}

function skippedLines(skipped) {
  if (!skipped || skipped.length === 0) return [];
  return ['', '⏭️ Skipped:', ...skipped.map(s => `${s.label}: ${s.reason}`)];
}

export async function safeReply(route, message) {
  try {
    return await notify(route, message);
  } catch (error) {
    console.error(`❌ Could not reply on ${route?.channel} to ${route?.to}:`, error.message);
    return { sent: false, reason: error.message };
  }
}

// ============================================================================
// ZERNIO WEBHOOK (scheduled + queued posts)
// Subscribe in Zernio to post.published, post.partial, post.failed with this
// service's /zernio-webhook URL, and set ZERNIO_WEBHOOK_SECRET to the secret.
// ============================================================================

const seenEvents = new Set();

export async function handleZernioWebhook(req, res) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'ZERNIO_WEBHOOK_SECRET not set' });

  const signature = req.headers['x-zernio-signature'];
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
  if (!signature || signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body || {};
  res.json({ received: true });

  if (!['post.published', 'post.partial', 'post.failed'].includes(event.event)) return;
  if (event.id) {
    if (seenEvents.has(event.id)) return; // Zernio retries keep the same id
    seenEvents.add(event.id);
    if (seenEvents.size > 5000) seenEvents.clear();
  }

  const meta = event.post?.metadata || {};
  if (meta.source !== 'text-to-attention' || meta.replyVia === 'inline' || !meta.replyChannel || !meta.replyTo) return;

  const route = {
    channel: meta.replyChannel,
    to: meta.replyTo,
    from: meta.replyFrom || undefined,
    lastInboundAt: Number(meta.replyLastInboundAt) || 0,
    inReplyTo: meta.replyRef || undefined,
    subject: meta.replySubject || undefined
  };
  const user = findUser(route.channel, route.to);
  const title = meta.title || titleOf(event.post?.content);
  await safeReply(route, whereItWent(platformResults(event.post, accountLabels(user)), [], title));
}
