import { pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  channel: text('channel').notNull(), // 'whatsapp' | 'sms' | 'email'
  key: text('key').notNull(), // machine key e.g. 'thank_you_v2'
  version: text('version').notNull().default('1'),
  body: text('body').notNull(), // with {{variable}} slots
  variables: text('variables').array().notNull().default([]),
  hasMediaHeader: boolean('has_media_header').notNull().default(false),
  // WhatsApp Meta template fields
  metaTemplateName: text('meta_template_name'),
  metaStatus: text('meta_status').default('draft'), // 'draft'|'pending'|'approved'|'rejected'
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
