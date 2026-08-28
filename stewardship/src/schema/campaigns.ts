import { pgTable, text, boolean, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  platform: text('platform').notNull(), // 'charidy' | 'causematch' | 'manual'
  externalId: text('external_id').notNull(), // Charidy campaign ID e.g. '47618'
  name: text('name').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  goalCents: integer('goal_cents'),
  sendEnabled: boolean('send_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
