import express from 'express';
import twilio from 'twilio';
import mailparser from 'mailparser';
import fetch from 'node-fetch';
import fs from 'fs';
import cron from 'node-cron';
import { google } from 'googleapis';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Environment variables
const LATE_API_KEY = process.env.LATE_API_KEY;
const EMAILIT_API_KEY = process.env.EMAILIT_API_KEY;

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const ALLOWED_NUMBERS = process.env.ALLOWED_NUMBERS?.split(',') || [];
const ALLOWED_SENDERS = process.env.ALLOWED_SENDERS?.split(',') || [];
const ALLOWED_WHATSAPP_NUMBERS = process.env.ALLOWED_WHATSAPP_NUMBERS?.split(',') || [];

// Calendar reminder config
const CALENDAR_ID = process.env.CALENDAR_ID || 'david@attentionearned.com';
const REMINDER_TO_NUMBER = process.env.REMINDER_TO_NUMBER;   // your flip phone
const REMINDER_FROM_NUMBER = process.env.REMINDER_FROM_NUMBER || process.env.TWILIO_FROM_NUMBER;

// Load users configuration
let usersConfig = { users: [] };
try {
  const usersData = fs.readFileSync('./users.json', 'utf8');
  usersConfig = JSON.parse(usersData);
  console.log(`📋 Loaded ${usersConfig.users.length} user(s) from users.json`);
} catch (error) {
  console.warn('⚠️  Could not load users.json, using fallback mode with LATE_API_KEY');
}

const postUserMap = new Map();

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'message/rfc822', limit: '50mb' }));

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    status: 'alive',
    service: 'attentionearned-service',
    endpoints: {
      sms: '/sms-webhook',
      whatsapp: '/whatsapp-webhook',
      email: '/email-webhook'
    },
    features: ['text', 'images', 'videos', 'scheduling', 'whatsapp', 'calendar-reminders']
  });
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

function findUserByEmail(email) {
  if (!email) return null;
  const normalizedEmail = email.toLowerCase().trim();
  return usersConfig.users.find(u => u.email.toLowerCase() === normalizedEmail);
}

function findUserByPhone(phone) {
  if (!phone) return null;
  return usersConfig.users.find(u => u.phone === phone.trim());
}

function findUserByWhatsApp(whatsappNumber) {
  if (!whatsappNumber) return null;
  const normalizedNumber = whatsappNumber.replace('whatsapp:', '').trim();
  return usersConfig.users.find(u =>
    u.whatsapp === normalizedNumber ||
    u.whatsapp === whatsappNumber ||
    u.phone === normalizedNumber
  );
}

// ============================================================================
// EMAIL COMMAND PARSER
// ============================================================================

function parseEmailCommand(subject, text) {
  const content = `${subject}\n${text}`.toLowerCase();

  const platforms = [];
  const platformKeywords = {
    'twitter': 'twitter', 'instagram': 'instagram', 'facebook': 'facebook',
    'linkedin': 'linkedin', 'tiktok': 'tiktok', 'youtube': 'youtube',
    'threads': 'threads', 'bluesky': 'bluesky', 'pinterest': 'pinterest', 'reddit': 'reddit'
  };

  let postToAll = false;
  if (/post to all/i.test(content)) {
    postToAll = true;
  } else {
    for (const [keyword, platform] of Object.entries(platformKeywords)) {
      if (new RegExp(`post to[^\\n]*${keyword}`, 'i').test(content)) {
        platforms.push(platform);
      }
    }
  }

  let publishingMode = 'now';
  let scheduledFor = null;
  let timezone = 'UTC';

  if (/add to queue/i.test(content)) {
    publishingMode = 'queue';
  } else if (/post now|publish now/i.test(content)) {
    publishingMode = 'now';
  } else if (/schedule:|post at/i.test(content)) {
    publishingMode = 'schedule';

    const scheduleMatch = content.match(/(?:schedule:|post at)\s*([^\n]+)/i);
    if (scheduleMatch) {
      const dateString = scheduleMatch[1].trim();

      const isoMatch = dateString.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?)/);
      if (isoMatch) {
        scheduledFor = isoMatch[1].replace(' ', 'T');
      }

      const relativeMatch = dateString.match(/(tomorrow|today)\s+(\d{1,2})(am|pm)/i);
      if (relativeMatch) {
        const [, when, hour, ampm] = relativeMatch;
        let hours = parseInt(hour);
        if (ampm.toLowerCase() === 'pm' && hours !== 12) hours += 12;
        if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;

        const date = new Date();
        if (when.toLowerCase() === 'tomorrow') date.setDate(date.getDate() + 1);
        date.setHours(hours, 0, 0, 0);
        scheduledFor = date.toISOString().slice(0, 16);
      }

      const tzMatch = dateString.match(/\b([A-Z]{2,4})\b$/);
      if (tzMatch) {
        const tzMap = {
          'EST': 'America/New_York', 'EDT': 'America/New_York',
          'PST': 'America/Los_Angeles', 'PDT': 'America/Los_Angeles',
          'CST': 'America/Chicago', 'CDT': 'America/Chicago',
          'MST': 'America/Denver', 'MDT': 'America/Denver',
          'UTC': 'UTC', 'GMT': 'UTC'
        };
        timezone = tzMap[tzMatch[1].toUpperCase()] || 'UTC';
      }
    }
  }

  return { platforms, postToAll, publishingMode, scheduledFor, timezone };
}

// ============================================================================
// EMAILIT INTEGRATION
// ============================================================================

async function sendEmailitEmail(to, subject, htmlBody, textBody) {
  if (!EMAILIT_API_KEY) {
    console.warn('⚠️  EMAILIT_API_KEY not configured, skipping email notification');
    return;
  }

  try {
    const response = await fetch('https://api.emailit.com/v1/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${EMAILIT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [{ email: to }], subject, html: htmlBody, text: textBody })
    });

    if (!response.ok) {
      console.error('❌ Emailit error:', await response.text());
    } else {
      console.log(`✅ Confirmation email sent to ${to}`);
    }
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
  }
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadToLate(mediaBuffer, contentType, filename, apiKey) {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('files', mediaBuffer, { filename, contentType });

  const key = apiKey || LATE_API_KEY;
  const response = await fetchWithTimeout('https://getlate.dev/api/v1/media', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, ...form.getHeaders() },
    body: form
  }, 8000);

  if (!response.ok) throw new Error(`Late.dev upload failed: ${await response.text()}`);
  return response.json();
}

function getMediaType(contentType) {
  if (contentType.startsWith('video/')) return 'video';
  return 'image';
}

async function downloadTwilioMedia(mediaUrl) {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetchWithTimeout(mediaUrl, { headers: { 'Authorization': `Basic ${auth}` } }, 5000);
  if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
  return response;
}

function buildPlatformsArray(user, command) {
  if (!user?.accounts) return [];
  if (command.postToAll || command.platforms.length === 0) {
    return Object.entries(user.accounts).map(([platform, accountId]) => ({ platform, accountId }));
  }
  return command.platforms
    .filter(p => user.accounts[p])
    .map(p => ({ platform: p, accountId: user.accounts[p] }));
}

async function postToLate(postData, apiKey) {
  return fetchWithTimeout('https://getlate.dev/api/v1/posts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(postData)
  }, 10000);
}

// ============================================================================
// SMS/MMS ENDPOINT
// ============================================================================

app.post('/sms-webhook', async (req, res) => {
  try {
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers['x-twilio-signature'];
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const url = `${protocol}://${req.get('host')}${req.originalUrl}`;
      if (!twilio.validateRequest(TWILIO_AUTH_TOKEN, twilioSignature, url, req.body)) {
        console.error('Invalid Twilio signature');
        return res.status(403).send('Forbidden');
      }
    }

    const { Body: message, From: fromNumber, NumMedia: numMedia } = req.body;
    const mediaCount = parseInt(numMedia) || 0;
    console.log(`📱 SMS/MMS from ${fromNumber} with ${mediaCount} media`);

    if (ALLOWED_NUMBERS.length > 0 && !ALLOWED_NUMBERS.includes(fromNumber)) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, your number is not authorized to post.');
      return res.type('text/xml').send(twiml.toString());
    }

    const user = findUserByPhone(fromNumber);
    if (!user && usersConfig.users.length > 0 && !LATE_API_KEY) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Your number is not configured. Please contact support.');
      return res.type('text/xml').send(twiml.toString());
    }

    const apiKey = user?.lateApiKey || LATE_API_KEY;
    const command = parseEmailCommand('', message || '');
    const mediaItems = [];

    for (let i = 0; i < mediaCount; i++) {
      try {
        const mediaResponse = await downloadTwilioMedia(req.body[`MediaUrl${i}`]);
        const contentType = req.body[`MediaContentType${i}`];
        const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
        const filename = `media-${Date.now()}-${i}.${contentType.split('/')[1] || 'jpg'}`;
        const uploadResult = await uploadToLate(mediaBuffer, contentType, filename, apiKey);
        if (uploadResult.files?.[0]) {
          mediaItems.push({ type: getMediaType(contentType), url: uploadResult.files[0].url, filename: uploadResult.files[0].filename });
        }
      } catch (error) {
        console.error(`   ❌ Failed media ${i}:`, error.message);
      }
    }

    let postContent = (message || '📸').replace(/(?:post to|add to queue|post now)\s*[^\n]*/gi, '').trim();
    if (!postContent && mediaItems.length > 0) postContent = '📸';

    const platformsArray = buildPlatformsArray(user, command);
    const postData = { content: postContent };
    if (mediaItems.length > 0) postData.mediaItems = mediaItems;
    if (platformsArray.length > 0) postData.platforms = platformsArray;

    if (command.publishingMode === 'queue' && user?.profileId) {
      postData.queuedFromProfile = user.profileId;
    } else {
      postData.publishNow = true;
    }

    const lateResponse = await postToLate(postData, apiKey);
    const responseData = await lateResponse.json();
    const twiml = new twilio.twiml.MessagingResponse();

    if (lateResponse.ok) {
      const postId = responseData.post?._id;
      if (postId && user) postUserMap.set(postId, user.email);
      const platformsList = platformsArray.length > 0 ? platformsArray.map(p => p.platform).join(', ') : 'all platforms';
      const modeText = command.publishingMode === 'queue' ? ' (queued)' : '';
      const mediaEmoji = mediaItems.length > 0 ? ` with ${mediaItems.length} media 📸` : '';
      twiml.message(`✅ Posted${modeText}${mediaEmoji} to ${platformsList}!`);
    } else {
      twiml.message(`❌ Post failed: ${responseData.error || 'Unknown error'}`);
    }

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('💥 Error processing SMS/MMS:', error);
    if (!res.headersSent) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('❌ Error posting. Please try again.');
      res.type('text/xml').send(twiml.toString());
    }
  }
});

// ============================================================================
// WHATSAPP ENDPOINT
// ============================================================================

app.post('/whatsapp-webhook', async (req, res) => {
  try {
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers['x-twilio-signature'];
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const url = `${protocol}://${req.get('host')}${req.originalUrl}`;
      if (!twilio.validateRequest(TWILIO_AUTH_TOKEN, twilioSignature, url, req.body)) {
        console.error('Invalid Twilio signature for WhatsApp');
        return res.status(403).send('Forbidden');
      }
    }

    const { Body: message, From: fromNumber, NumMedia: numMedia } = req.body;
    const mediaCount = parseInt(numMedia) || 0;
    const cleanNumber = fromNumber.replace('whatsapp:', '');
    console.log(`💬 WhatsApp from ${cleanNumber} with ${mediaCount} media`);

    if (ALLOWED_WHATSAPP_NUMBERS.length > 0 && !ALLOWED_WHATSAPP_NUMBERS.includes(cleanNumber)) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, your WhatsApp number is not authorized to post.');
      return res.type('text/xml').send(twiml.toString());
    }

    const user = findUserByWhatsApp(fromNumber);
    if (!user && usersConfig.users.length > 0 && !LATE_API_KEY) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Your WhatsApp number is not configured. Please contact support.');
      return res.type('text/xml').send(twiml.toString());
    }

    const apiKey = user?.lateApiKey || LATE_API_KEY;
    const command = parseEmailCommand('', message || '');
    const mediaItems = [];

    for (let i = 0; i < mediaCount; i++) {
      try {
        const mediaResponse = await downloadTwilioMedia(req.body[`MediaUrl${i}`]);
        const contentType = req.body[`MediaContentType${i}`];
        const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
        const filename = `whatsapp-media-${Date.now()}-${i}.${contentType.split('/')[1] || 'jpg'}`;
        const uploadResult = await uploadToLate(mediaBuffer, contentType, filename, apiKey);
        if (uploadResult.files?.[0]) {
          mediaItems.push({ type: getMediaType(contentType), url: uploadResult.files[0].url, filename: uploadResult.files[0].filename });
        }
      } catch (error) {
        console.error(`   ❌ Failed WhatsApp media ${i}:`, error.message);
      }
    }

    let postContent = (message || '📸').replace(/(?:post to|add to queue|post now)\s*[^\n]*/gi, '').trim();
    if (!postContent && mediaItems.length > 0) postContent = '📸';

    const platformsArray = buildPlatformsArray(user, command);
    const postData = { content: postContent };
    if (mediaItems.length > 0) postData.mediaItems = mediaItems;
    if (platformsArray.length > 0) postData.platforms = platformsArray;

    if (command.publishingMode === 'queue' && user?.profileId) {
      postData.queuedFromProfile = user.profileId;
    } else if (command.publishingMode === 'schedule' && command.scheduledFor) {
      postData.publishNow = false;
      postData.scheduledFor = command.scheduledFor;
      postData.timezone = command.timezone;
    } else {
      postData.publishNow = true;
    }

    const lateResponse = await postToLate(postData, apiKey);
    const responseData = await lateResponse.json();
    const twiml = new twilio.twiml.MessagingResponse();

    if (lateResponse.ok) {
      const postId = responseData.post?._id;
      if (postId && user) postUserMap.set(postId, user.email);
      const platformsList = platformsArray.length > 0 ? platformsArray.map(p => p.platform).join(', ') : 'all platforms';
      const mediaEmoji = mediaItems.length > 0 ? ` with ${mediaItems.length} media 📸` : '';
      let modeText = '';
      if (command.publishingMode === 'queue') modeText = ' (queued)';
      else if (command.publishingMode === 'schedule') modeText = ` (scheduled for ${command.scheduledFor})`;
      twiml.message(`✅ Posted${modeText}${mediaEmoji} to ${platformsList}!`);

      if (user && EMAILIT_API_KEY) {
        await sendEmailitEmail(
          user.email,
          `✅ WhatsApp Post ${command.publishingMode === 'now' ? 'Published' : command.publishingMode}`,
          `<h2>WhatsApp Post Confirmation</h2><p><strong>Platforms:</strong> ${platformsList}</p><p><strong>Content:</strong> ${postContent}</p>`,
          `WhatsApp Post ${command.publishingMode} to ${platformsList}\n\n${postContent}`
        );
      }
    } else {
      twiml.message(`❌ Post failed: ${responseData.error || 'Unknown error'}`);
    }

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('💥 Error processing WhatsApp message:', error);
    if (!res.headersSent) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('❌ Error posting. Please try again.');
      res.type('text/xml').send(twiml.toString());
    }
  }
});

// ============================================================================
// EMAIL ENDPOINT
// ============================================================================

app.post('/email-webhook', async (req, res) => {
  try {
    console.log('📧 Received email webhook');

    let emailData;
    if (req.headers['content-type']?.includes('application/json')) {
      emailData = req.body;
    } else if (req.headers['content-type']?.includes('message/rfc822')) {
      const simpleParser = mailparser.simpleParser;
      const parsed = await simpleParser(req.body);
      emailData = { from: parsed.from.text, subject: parsed.subject, text: parsed.text, html: parsed.html, attachments: parsed.attachments };
    } else {
      emailData = req.body;
    }

    const fromEmail = emailData.from?.toLowerCase() || emailData.email?.toLowerCase();
    const subject = emailData.subject || '';
    const textContent = emailData.text || emailData['body-plain'] || '';
    const attachments = emailData.attachments || [];

    if (ALLOWED_SENDERS.length > 0 && !ALLOWED_SENDERS.includes(fromEmail)) {
      return res.status(403).json({ error: 'Unauthorized sender' });
    }

    const user = findUserByEmail(fromEmail);
    if (!user && usersConfig.users.length > 0 && !LATE_API_KEY) {
      return res.status(403).json({ error: 'User not configured in users.json' });
    }

    const apiKey = user?.lateApiKey || LATE_API_KEY;
    const command = parseEmailCommand(subject, textContent);
    const mediaItems = [];

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const contentType = attachment.contentType || attachment.type || 'application/octet-stream';
      if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) continue;

      try {
        const mediaBuffer = Buffer.from(attachment.content || attachment.data, 'base64');
        const uploadResult = await uploadToLate(mediaBuffer, contentType, attachment.filename, apiKey);
        if (uploadResult.files?.[0]) {
          mediaItems.push({ type: getMediaType(contentType), url: uploadResult.files[0].url, filename: uploadResult.files[0].filename });
        }
      } catch (error) {
        console.error(`   ❌ Failed ${attachment.filename}:`, error.message);
      }
    }

    let postContent = textContent
      .replace(/(?:schedule:|post at)\s*[^\n]+/gi, '')
      .replace(/(?:post to|add to queue|post now)\s*[^\n]*/gi, '')
      .trim();

    if (!postContent) {
      postContent = subject.replace(/(?:schedule:|post at)\s*[^\n]+/gi, '').replace(/(?:post to|add to queue|post now)\s*[^\n]*/gi, '').trim();
    }
    if (!postContent && mediaItems.length > 0) postContent = '📸';

    const platformsArray = buildPlatformsArray(user, command);
    const postData = { content: postContent };
    if (mediaItems.length > 0) postData.mediaItems = mediaItems;
    if (platformsArray.length > 0) postData.platforms = platformsArray;

    if (command.publishingMode === 'now') {
      postData.publishNow = true;
    } else if (command.publishingMode === 'schedule') {
      postData.publishNow = false;
      postData.scheduledFor = command.scheduledFor;
      postData.timezone = command.timezone;
    } else if (command.publishingMode === 'queue') {
      if (user?.profileId) postData.queuedFromProfile = user.profileId;
      else postData.publishNow = true;
    }

    const lateResponse = await postToLate(postData, apiKey);
    const responseData = await lateResponse.json();

    if (lateResponse.ok) {
      const postId = responseData.post?._id;
      if (postId && user) postUserMap.set(postId, user.email);

      let modeDescription = 'immediately';
      if (command.publishingMode === 'schedule') modeDescription = `scheduled for ${command.scheduledFor} ${command.timezone}`;
      else if (command.publishingMode === 'queue') modeDescription = 'added to queue';

      const platformsList = platformsArray.map(p => p.platform).join(', ') || 'all platforms';

      if (user && EMAILIT_API_KEY) {
        await sendEmailitEmail(
          user.email,
          `✅ Post ${modeDescription}`,
          `<h2>Post Confirmation</h2><p><strong>Status:</strong> ${modeDescription}</p><p><strong>Platforms:</strong> ${platformsList}</p><p><strong>Content:</strong> ${postContent}</p>`,
          `Post ${modeDescription} to ${platformsList}\n\n${postContent}`
        );
      }

      res.json({ success: true, message: `Posted ${modeDescription} to ${platformsList}`, postId, platforms: platformsArray.map(p => p.platform) });
    } else {
      if (user && EMAILIT_API_KEY) {
        await sendEmailitEmail(user.email, '❌ Post Failed', `<h2>Post Error</h2><p>${responseData.error || 'Unknown error'}</p>`, `Post failed: ${responseData.error}`);
      }
      res.status(500).json({ success: false, error: responseData.error || 'Failed to post' });
    }
  } catch (error) {
    console.error('💥 Error processing email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// LATE.DEV WEBHOOK
// ============================================================================

app.post('/late-webhook', async (req, res) => {
  try {
    const event = req.body;
    const postData = event.post;
    const userEmail = postUserMap.get(postData?._id);
    if (!userEmail) return res.json({ received: true });

    const user = findUserByEmail(userEmail);
    if (!user) return res.json({ received: true });

    if (event.type === 'post.published' && EMAILIT_API_KEY) {
      await sendEmailitEmail(user.email, '🎉 Your post is now live!',
        `<h2>Post Published</h2><p>${postData.content || 'N/A'}</p>`,
        `Your post is now live!\n\n${postData.content || 'N/A'}`);
    } else if (event.type === 'post.failed' && EMAILIT_API_KEY) {
      await sendEmailitEmail(user.email, '❌ Post failed to publish',
        `<h2>Post Failed</h2><p>${postData.error || 'Unknown error'}</p>`,
        `Post failed: ${postData.error || 'Unknown error'}`);
    }

    postUserMap.delete(postData?._id);
    res.json({ received: true });
  } catch (error) {
    console.error('💥 Error processing Late.dev webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CALENDAR REMINDER CRON (every 5 minutes)
// 30-min reminder: event starts in 25-30 min
// 10-min reminder: event starts in 5-10 min
// ============================================================================

async function checkCalendarAndRemind() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return; // silently skip if not configured
  }
  if (!REMINDER_TO_NUMBER || !REMINDER_FROM_NUMBER) {
    return;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 35 * 60 * 1000);

    const { data } = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = data.items ?? [];
    const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const REMINDER_WINDOWS = [
      { min: 25, max: 30, label: '30 minutes' },
      { min: 5,  max: 10, label: '10 minutes' },
    ];

    for (const event of events) {
      const startStr = event.start?.dateTime ?? event.start?.date;
      if (!startStr) continue;

      const start = new Date(startStr);
      const minutesUntil = (start.getTime() - now.getTime()) / 60000;
      const title = event.summary ?? 'Meeting';

      for (const window of REMINDER_WINDOWS) {
        if (minutesUntil >= window.min && minutesUntil < window.max) {
          const timeStr = start.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
          });
          await twilioClient.messages.create({
            body: `Reminder: "${title}" starts in ${window.label} at ${timeStr}`,
            from: REMINDER_FROM_NUMBER,
            to: REMINDER_TO_NUMBER,
          });
          console.log(`📅 Sent ${window.label} reminder for "${title}"`);
        }
      }
    }
  } catch (error) {
    console.error('💥 Calendar reminder error:', error.message);
  }
}

// Run every 5 minutes
cron.schedule('*/5 * * * *', checkCalendarAndRemind);
console.log('📅 Calendar reminder cron started (every 5 min)');

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

process.on('uncaughtException', (err) => console.error('💥 Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('💥 Unhandled Rejection:', reason));

// ============================================================================
// START
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Attention Earned service running on port ${PORT}`);
  console.log(`📱 SMS: /sms-webhook | 💬 WhatsApp: /whatsapp-webhook | 📧 Email: /email-webhook`);
  console.log(`👥 Configured users: ${usersConfig.users.length}`);
});
