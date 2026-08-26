import { pgTable, text, timestamp, uuid, integer, unique } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';

export const donors = pgTable('donors', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  hebrewName: text('hebrew_name'),
  email: text('email'),
  phoneE164: text('phone_e164'), // E.164 format only
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  region: text('region'), // state/province
  postalCode: text('postal_code'),
  country: text('country'), // ISO 3166-1 alpha-2
  timezone: text('timezone'), // IANA tz; drives Shabbos blackout. null = unknown = skip all sends
  // v2 ONLY — create column so seam exists; never read/write in v1 logic
  candleLightingZoneId: uuid('candle_lighting_zone_id'),
  firstGiftAt: timestamp('first_gift_at', { withTimezone: true }),
  lastGiftAt: timestamp('last_gift_at', { withTimezone: true }),
  lifetimeCents: integer('lifetime_cents').notNull().default(0),
  giftCount: integer('gift_count').notNull().default(0),
  ladderStage: text('ladder_stage').notNull().default('new'), // 'new'|'stewarded'|'repeat'|'recurring'|'mid'|'major_referred'
  dedupeKey: text('dedupe_key').notNull(), // see deduplicator.ts for key format
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueDedupeKey: unique().on(t.orgId, t.dedupeKey),
}));

export type Donor = typeof donors.$inferSelect;
export type NewDonor = typeof donors.$inferInsert;
