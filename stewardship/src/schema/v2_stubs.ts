// v2 ONLY — schema stubs so FK seams exist. Write zero logic against these tables in v1.
// enrichments: Hatch Partner API enrichment data (Phase 7)
// subject_embeddings: InsightFace ArcFace embeddings for face recognition (Phase 8)

import { pgTable, text, timestamp, uuid, boolean, jsonb, real, unique } from 'drizzle-orm/pg-core';
import { donors } from './donors.js';
import { subjects } from './media.js';
import { mediaAssets } from './media.js';

export const enrichments = pgTable('enrichments', {
  id: uuid('id').primaryKey().defaultRandom(),
  donorId: uuid('donor_id').notNull().references(() => donors.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('hatch'),
  matched: boolean('matched'),
  matchConfidence: real('match_confidence'),
  capacityScore: real('capacity_score'),
  affinityScore: real('affinity_score'),
  propensityScore: real('propensity_score'),
  raw: jsonb('raw'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
}, (t) => ({
  uniqueDonorProvider: unique().on(t.donorId, t.provider),
}));

// v2 ONLY: ArcFace embeddings. pgvector extension required at migration time.
// Column type is text here as a placeholder — a v2 migration will ALTER to vector(512).
// Never populate in v1.
export const subjectEmbeddings = pgTable('subject_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
  // Placeholder: v2 will ALTER this to vector(512) via pgvector migration
  embeddingPlaceholder: text('embedding_placeholder'),
  sourceAssetId: uuid('source_asset_id').references(() => mediaAssets.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Enrichment = typeof enrichments.$inferSelect;
export type SubjectEmbedding = typeof subjectEmbeddings.$inferSelect;
