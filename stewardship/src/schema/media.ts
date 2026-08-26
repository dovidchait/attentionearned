import { pgTable, text, timestamp, uuid, integer, boolean, real, unique } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';
import { donors } from './donors.js';

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(), // 'image' | 'video' | 'audio'
  originalUri: text('original_uri').notNull(),
  originalBytes: integer('original_bytes'),
  mime: text('mime'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  designationId: uuid('designation_id'), // nullable
  tags: text('tags').array().notNull().default([]),
  facesPresent: boolean('faces_present').notNull().default(false),
  releaseOnFile: boolean('release_on_file').notNull().default(false), // REQUIRED true to send
  taggingState: text('tagging_state').notNull().default('untagged'), // 'untagged'|'tagged'|'no_subjects'
  usageCount: integer('usage_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  displayName: text('display_name').notNull(), // internal label only, not shown to donors
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  enrollmentAssetId: uuid('enrollment_asset_id'), // reference photo for v2 face-recog
  // v2 REQUIRED before any embedding — irrelevant to v1 manual tagging
  biometricConsentOnFile: boolean('biometric_consent_on_file').notNull().default(false),
  // v1 REQUIRED: parental OK to send this child's image to family
  photoConsentOnFile: boolean('photo_consent_on_file').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mediaAssetSubjects = pgTable('media_asset_subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  assetId: uuid('asset_id').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
  // 1.0 for human tags; model score for v2 auto tags
  confidence: real('confidence').notNull().default(1.0),
  // v1: always 'human_confirmed'. v2 adds 'auto' (suggestion only, cannot gate a send)
  method: text('method').notNull().default('human_confirmed'),
  confirmedBy: text('confirmed_by'), // user/operator who confirmed
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (t) => ({
  uniqueAssetSubject: unique().on(t.assetId, t.subjectId),
}));

export const donorSubjectLinks = pgTable('donor_subject_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
  relationship: text('relationship').notNull(), // 'parent' | 'grandparent' | 'other'
  verifiedBy: text('verified_by').notNull(), // operator who verified this link
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueDonorSubject: unique().on(t.donorId, t.subjectId),
}));

export const mediaRenditions = pgTable('media_renditions', {
  id: uuid('id').primaryKey().defaultRandom(),
  assetId: uuid('asset_id').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // 'whatsapp' | 'email'
  uri: text('uri').notNull(),
  bytes: integer('bytes'),
  mime: text('mime'),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  specVersion: text('spec_version').notNull().default('v1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type MediaAssetSubject = typeof mediaAssetSubjects.$inferSelect;
export type DonorSubjectLink = typeof donorSubjectLinks.$inferSelect;
export type MediaRendition = typeof mediaRenditions.$inferSelect;
