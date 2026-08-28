import { pgTable, text, boolean, timestamp, uuid } from 'drizzle-orm/pg-core';

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('onboarding'), // 'onboarding'|'live'|'paused'|'offboarded'
  defaultTimezone: text('default_timezone').notNull().default('America/New_York'),
  zernioProfileId: text('zernio_profile_id'),
  zernioPhoneNumberId: text('zernio_phone_number_id'),
  wabaOwner: text('waba_owner'), // 'client' | 'agency'
  emailitSenderDomain: text('emailit_sender_domain'),
  sendEnabled: boolean('send_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
