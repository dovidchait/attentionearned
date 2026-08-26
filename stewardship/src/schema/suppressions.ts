import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';
import { donors } from './donors.js';

export const suppressions = pgTable('suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  donorId: uuid('donor_id').references(() => donors.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(), // 'opt_out' | 'hard_bounce' | 'complaint' | 'shiva' | 'manual'
  scope: text('scope').notNull().default('all'), // 'all' | 'whatsapp' | 'sms' | 'email'
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }), // null = permanent
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Suppression = typeof suppressions.$inferSelect;
export type NewSuppression = typeof suppressions.$inferInsert;
