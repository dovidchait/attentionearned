import { pgTable, text, timestamp, uuid, integer, boolean, unique } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';
import { donors } from './donors.js';
import { campaigns } from './campaigns.js';
import { designations } from './designations.js';

export const gifts = pgTable('gifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'restrict' }),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
  designationId: uuid('designation_id').references(() => designations.id),
  // Amount the donor actually paid — not the matched/multiplied total
  amountCents: integer('amount_cents').notNull(),
  // Post-match total for reference; not used for stewardship copy
  matchedTotalCents: integer('matched_total_cents'),
  currency: text('currency').notNull().default('USD'),
  gateway: text('gateway'), // processor name, [ID] prefix stripped
  teamReferrer: text('team_referrer'), // team name from team_donations join
  dedicationText: text('dedication_text'),
  isRecurring: boolean('is_recurring').notNull().default(false),
  recurringInterval: text('recurring_interval'), // 'month' | 'year'
  status: text('status').notNull(), // 'processed' | 'failed' | 'authorized'
  platform: text('platform').notNull(), // 'charidy' | 'causematch' | 'manual'
  // Platform-native donation ID — used for idempotent import
  externalId: text('external_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueExternalId: unique().on(t.orgId, t.platform, t.externalId),
}));

export type Gift = typeof gifts.$inferSelect;
export type NewGift = typeof gifts.$inferInsert;
