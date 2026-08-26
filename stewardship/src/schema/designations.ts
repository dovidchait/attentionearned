import { pgTable, text, timestamp, uuid, integer, boolean } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';

export const designations = pgTable('designations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  key: text('key').notNull(), // machine key e.g. 'siddur'
  unitNounSingular: text('unit_noun_singular').notNull(), // 'siddur'
  unitNounPlural: text('unit_noun_plural').notNull(), // 'siddurim'
  unitAmountCents: integer('unit_amount_cents').notNull(), // 1800
  impactPhrase: text('impact_phrase').notNull(), // 'put a siddur in a child\'s hands'
  ladderNextId: uuid('ladder_next_id'), // FK to next rung up (self-referential, set post-insert)
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Designation = typeof designations.$inferSelect;
export type NewDesignation = typeof designations.$inferInsert;
