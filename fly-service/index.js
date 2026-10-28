import express from 'express';
import twilio from 'twilio';
import cron from 'node-cron';
import { google } from 'googleapis';
import { channels, smsEnabled } from './lib/channels.js';
import { inboundHandler, handleZernioWebhook } from './lib/poster.js';
import { emailWebhook } from './lib/emailit.js';
import { allUsers } from './lib/users.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Environment variables (see .env.example / README)
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;

// Calendar reminder config
const CALENDAR_ID = process.env.CALENDAR_ID || 'david@attentionearned.com';
const REMINDER_TO_NUMBER = process.env.REMINDER_TO_NUMBER;   // your flip phone
const REMINDER_FROM_NUMBER = process.env.REMINDER_FROM_NUMBER || process.env.TWILIO_FROM_NUMBER;

if (!process.env.ZERNIO_API_KEY) console.warn('⚠️  ZERNIO_API_KEY is not set: posting will not work');

// Middleware (rawBody is kept for webhook signature checks)
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '60mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.raw({ type: 'message/rfc822', limit: '50mb' }));

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    status: 'alive',
    service: 'attentionearned-service',
    posting: 'zernio',
    endpoints: {
      sms: '/sms-webhook',
      whatsapp: '/whatsapp-webhook',
      email: '/email-webhook',
      zernio: '/zernio-webhook'
    },
    features: ['text', 'images', 'videos', 'media-links', 'scheduling', 'whatsapp', 'live-links-reply', 'calendar-reminders'],
    // configuration only (true/false), never values
    config: {
      sms: smsEnabled(),
      whatsappSender: Boolean(process.env.TWILIO_WHATSAPP_FROM),
      whatsappTemplate: Boolean(process.env.TWILIO_WA_TEMPLATE_POSTED_SID),
      twilioSignatureCheck: Boolean(process.env.TWILIO_AUTH_TOKEN) && process.env.TWILIO_SKIP_SIGNATURE_CHECK !== 'true',
      emailOut: Boolean(process.env.EMAILIT_API_KEY),
      emailInbound: Boolean(process.env.EMAILIT_WEBHOOK_SECRET),
      zernio: Boolean(process.env.ZERNIO_API_KEY),
      zernioWebhook: Boolean(process.env.ZERNIO_WEBHOOK_SECRET),
      envAllowlistEnforced: String(process.env.ENFORCE_ENV_ALLOWLIST || '').trim().toLowerCase() === 'true'
    }
  });
});

// ============================================================================
// INBOUND CHANNELS -> POST THROUGH ZERNIO -> REPLY WITH LIVE LINKS
// Channel logic lives in lib/channels.js, posting in lib/poster.js.
// ============================================================================

app.post('/sms-webhook', inboundHandler(channels.sms));
app.post('/whatsapp-webhook', inboundHandler(channels.whatsapp));
// Emailit's signed email.received webhook (or another forwarder with EMAIL_WEBHOOK_SECRET)
app.post('/email-webhook', emailWebhook(inboundHandler(channels.email)));

// Zernio post events (scheduled/queued posts going live)
app.post('/zernio-webhook', handleZernioWebhook);

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
            body: `Attention Earned reminder: "${title}" starts in ${window.label} at ${timeStr}`,
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
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('*/5 * * * *', checkCalendarAndRemind);
  console.log('📅 Calendar reminder cron started (every 5 min)');
}

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

export default app;

if (process.env.NODE_ENV !== 'test') app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Attention Earned service running on port ${PORT}`);
  console.log(`📱 SMS: /sms-webhook (${smsEnabled() ? 'on' : 'off'}) | 💬 WhatsApp: /whatsapp-webhook | 📧 Email: /email-webhook | 🔔 Zernio: /zernio-webhook`);
  console.log(`👥 Configured users: ${allUsers().length}`);
});
