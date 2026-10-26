import crypto from 'crypto';
import { uploadMedia, createPost, waitForPost, isInFlight, platformResults } from './zernio.js';
import { parseCommand, stripCommands, selectTargets } from './commands.js';
import { findUser, apiKeyFor, accountLabels } from './users.js';
import { reply } from './channels.js';

// ============================================================================
// POSTING PIPELINE (channel-agnostic)
// inbound message -> user -> media upload -> Zernio post -> "where it went" reply
// ============================================================================

const ALLOWLISTS = {
  sms: process.env.ALLOWED_NUMBERS,
  whatsapp: process.env.ALLOWED_WHATSAPP_NUMBERS,
  email: process.env.ALLOWED_SENDERS
};

function allowedByEnv(channelName, sender) {
  const list = (ALLOWLISTS[channelName] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(String(sender).toLowerCase());
}

/**
 * Express handler factory: app.post('/sms-webhook', inboundHandler(channels.sms))
 * Answers the webhook immediately (Twilio gives us 15s), then posts in the
 * background and sends the result on the same channel.
 */
export function inboundHandler(channel) {
  return async (req, res) => {
    let message;
    let route;
    try {
      if (!channel.verify(req)) {
        console.error(`Invalid ${channel.name} webhook signature`);
        return res.status(403).send('Forbidden');
      }

      message = await channel.parse(req);
      console.log(`📨 ${channel.name} from ${message.from} with ${message.media.length} media`);

      const user = findUser(channel.name, message.from);
      if (!user || !allowedByEnv(channel.name, message.from)) {
        return channel.ack(res, 'Sorry, this number or address is not set up to post. Contact support.');
      }
      if (!apiKeyFor(user)) {
        console.error(`No Zernio key in env ${user.apiKeyEnv || 'ZERNIO_API_KEY'} for ${user.name}`);
        return channel.ack(res, 'Posting is not configured yet (missing Zernio key).');
      }

      route = { channel: channel.name, to: message.from, from: message.to };
      const command = parseCommand(message.subject, message.text, user.timezone || 'America/New_York');
      const caption = stripCommands(message.text) || stripCommands(message.subject);
      const mediaTypes = message.media.map(m => (m.contentType.startsWith('video/') ? 'video' : 'image'));
      const { targets, skipped } = selectTargets(user, command, { caption, mediaTypes });

      if (targets.length === 0) {
        return channel.ack(res, ['Nothing to post to.', ...skipped.map(s => `${s.label}: ${s.reason}`)].join('\n'));
      }

      const names = targets.map(t => t.account.label || t.account.platform).join(', ');
      const when = command.publishingMode === 'schedule' ? `Scheduling for ${command.scheduledFor} (${command.timezone})`
        : command.publishingMode === 'queue' ? 'Adding to your queue'
        : 'Posting now';
      channel.ack(res, `Got it. ${when}: ${names}. I'll send the links when they're live.`);

      // Background: the webhook has been answered
      publish({ channel, message, user, command, caption, targets, skipped, route }).catch(async error => {
        console.error('💥 Publish error:', error);
        await safeReply(route, `❌ Post failed: ${error.message}`);
      });
    } catch (error) {
      console.error(`💥 Error processing ${channel.name} message:`, error);
      if (!res.headersSent) channel.ack(res, '❌ Error posting. Please try again.');
      else if (route) await safeReply(route, `❌ Post failed: ${error.message}`);
    }
  };
}

async function publish({ channel, message, user, command, caption, targets, skipped, route }) {
  const apiKey = apiKeyFor(user);

  // 1. Media -> Zernio storage
  const mediaItems = [];
  for (const item of message.media) {
    try {
      const file = await channel.downloadMedia(item);
      mediaItems.push(await uploadMedia(file.buffer, file.contentType, file.filename, apiKey));
    } catch (error) {
      console.error(`   ❌ Failed media ${item.index}:`, error.message);
      skipped.push({ label: `Attachment ${item.index + 1}`, reason: `couldn't upload (${error.message})` });
    }
  }
  if (message.media.length > 0 && mediaItems.length === 0) {
    throw new Error('none of the attachments could be uploaded');
  }

  // 2. Build the post
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
  //    Video can still be processing on some platforms: wait for them, then report once.
  if (isInFlight(post)) {
    post = await waitForPost(post._id, apiKey);
  }
  await safeReply(route, formatWhereItWent(platformResults(post, labels), skipped));
}

/** The "where it went" message: live links, failures with the reason, anything still processing. */
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

export async function safeReply(route, text) {
  try {
    await reply(route, text);
  } catch (error) {
    console.error(`❌ Could not reply on ${route?.channel} to ${route?.to}:`, error.message);
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

  const route = { channel: meta.replyChannel, to: meta.replyTo, from: meta.replyFrom || undefined };
  const user = findUser(route.channel, route.to);
  await safeReply(route, formatWhereItWent(platformResults(event.post, accountLabels(user))));
}
