import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import twilio from 'twilio';

const CALENDAR_ID = 'david@attentionearned.com';

// Windows in minutes: [lowerBound, upperBound)
const REMINDER_WINDOWS = [
  { min: 25, max: 30, label: '30 minutes' },
  { min: 5,  max: 10, label: '10 minutes' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret to block unauthorized calls
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const sent: string[] = [];

  for (const event of events) {
    const startStr = event.start?.dateTime ?? event.start?.date;
    if (!startStr) continue;

    const start = new Date(startStr);
    const minutesUntil = (start.getTime() - now.getTime()) / 60000;
    const title = event.summary ?? 'Meeting';

    for (const window of REMINDER_WINDOWS) {
      if (minutesUntil >= window.min && minutesUntil < window.max) {
        const timeStr = start.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        });
        await client.messages.create({
          body: `Reminder: "${title}" starts in ${window.label} at ${timeStr}`,
          from: process.env.TWILIO_FROM_NUMBER!,
          to: process.env.TO_PHONE_NUMBER!,
        });
        sent.push(`${title} (${window.label})`);
      }
    }
  }

  return res.status(200).json({ sent, checkedEvents: events.length });
}
