import { pgTable, text, timestamp, uuid, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';
import { donors } from './donors.js';
import { templates } from './templates.js';
import { mediaAssets } from './media.js';

export const journeys = pgTable('journeys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  key: text('key').notNull(), // e.g. 'post_campaign_year_one'
  version: integer('version').notNull().default(1),
  active: boolean('active').notNull().default(false),
  definition: jsonb('definition').notNull(), // see §6 of build-spec.md
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journeyEnrollments = pgTable('journey_enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'restrict' }),
  journeyId: uuid('journey_id').notNull().references(() => journeys.id, { onDelete: 'restrict' }),
  state: text('state').notNull().default('active'), // 'active'|'completed'|'exited'
  currentStepKey: text('current_step_key'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  exitedAt: timestamp('exited_at', { withTimezone: true }),
  exitReason: text('exit_reason'),
});

export const touches = pgTable('touches', {
  id: uuid('id').primaryKey().defaultRandom(),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'restrict' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  journeyId: uuid('journey_id').references(() => journeys.id),
  stepKey: text('step_key'),
  channel: text('channel').notNull(), // 'whatsapp' | 'sms' | 'email'
  templateId: uuid('template_id').references(() => templates.id),
  assetId: uuid('asset_id').references(() => mediaAssets.id),
  askAmountCents: integer('ask_amount_cents'), // null for pure-stewardship touches
  variables: jsonb('variables'), // resolved template variable values
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  sendBucketId: text('send_bucket_id'),
  status: text('status').notNull().default('planned'), // 'planned'|'queued'|'sent'|'delivered'|'read'|'failed'|'skipped'
  skipReason: text('skip_reason'),
  provider: text('provider'), // 'zernio' | 'emailit'
  providerMessageId: text('provider_message_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'restrict' }),
  touchId: uuid('touch_id').references(() => touches.id),
  type: text('type').notNull(), // 'delivered'|'read'|'replied'|'clicked'|'failed'|'opt_out'|'gift'
  payload: jsonb('payload'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Journey = typeof journeys.$inferSelect;
export type JourneyEnrollment = typeof journeyEnrollments.$inferSelect;
export type Touch = typeof touches.$inferSelect;
export type Event = typeof events.$inferSelect;
