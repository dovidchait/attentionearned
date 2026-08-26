import pino from 'pino';
import { env } from './env.js';

// PII fields to redact at the serializer level.
// These paths apply to any nested object in the log payload.
const REDACTED_PATHS = [
  '*.email',
  '*.phone',
  '*.phone_e164',
  '*.first_name',
  '*.last_name',
  '*.hebrew_name',
  '*.address_line1',
  '*.address_line2',
  '*.city',
  '*.postal_code',
  '*.dedication',
  'donor.first_name',
  'donor.last_name',
  'donor.email',
  'donor.phone_e164',
];

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  serializers: {
    // Safe donor serializer: only exposes IDs
    donor: (d: Record<string, unknown>) => ({
      id: d['id'],
      org_id: d['org_id'],
    }),
    // Safe gift serializer
    gift: (g: Record<string, unknown>) => ({
      id: g['id'],
      donor_id: g['donor_id'],
      amount_cents: g['amount_cents'],
      campaign_id: g['campaign_id'],
    }),
    // Safe subject serializer
    subject: (s: Record<string, unknown>) => ({
      id: s['id'],
      org_id: s['org_id'],
    }),
    err: pino.stdSerializers.err,
  },
});

export type Logger = typeof logger;
