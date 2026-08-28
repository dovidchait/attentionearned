import { pgTable, text, timestamp, uuid, jsonb, unique } from 'drizzle-orm/pg-core';
import { donors } from './donors.js';

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // 'whatsapp' | 'sms' | 'email'
  state: text('state').notNull(), // 'opted_in' | 'opted_out' | 'unknown'
  source: text('source').notNull(), // 'campaign_checkbox' | 'reply_stop' | 'manual' | 'inferred'
  evidence: jsonb('evidence'), // raw evidence object
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueDonorChannel: unique().on(t.donorId, t.channel),
}));

export type Consent = typeof consents.$inferSelect;
export type NewConsent = typeof consents.$inferInsert;
