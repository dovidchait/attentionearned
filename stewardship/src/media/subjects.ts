import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { subjects, mediaAssets, mediaAssetSubjects, donorSubjectLinks } from '../schema/index.js';
import type { Subject, MediaAssetSubject, DonorSubjectLink } from '../schema/media.js';

export async function enrollSubject(
  orgId: string,
  displayName: string,
  options: { enrollmentAssetId?: string } = {},
): Promise<Subject> {
  const [subject] = await db.insert(subjects).values({
    orgId,
    displayName,
    enrollmentAssetId: options.enrollmentAssetId,
    photoConsentOnFile: false,
    biometricConsentOnFile: false,
    active: true,
  }).returning();
  return subject;
}

/**
 * Tag an asset as containing a subject.
 * v1: method is always 'human_confirmed'. An 'auto' tag (v2) can never gate a send.
 * Upserts — repeated calls update confirmedBy/confirmedAt.
 */
export async function tagAssetToSubject(
  assetId: string,
  subjectId: string,
  confirmedBy: string,
): Promise<MediaAssetSubject> {
  const now = new Date();

  // Insert or update if already exists (drizzle upsert on unique constraint)
  const [tag] = await db.insert(mediaAssetSubjects).values({
    assetId,
    subjectId,
    confidence: 1.0,
    method: 'human_confirmed',
    confirmedBy,
    confirmedAt: now,
  }).onConflictDoUpdate({
    target: [mediaAssetSubjects.assetId, mediaAssetSubjects.subjectId],
    set: {
      method: 'human_confirmed',
      confidence: 1.0,
      confirmedBy,
      confirmedAt: now,
    },
  }).returning();

  // Mark asset as tagged
  await db.update(mediaAssets)
    .set({ taggingState: 'tagged' })
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.taggingState, 'untagged')));

  return tag;
}

/**
 * Link a donor to a subject (e.g., parent → child).
 * Must be verified by a human operator — never inferred.
 * Upserts — repeated calls update relationship and verifiedBy.
 */
export async function linkDonorToSubject(
  donorId: string,
  subjectId: string,
  relationship: 'parent' | 'grandparent' | 'other',
  verifiedBy: string,
): Promise<DonorSubjectLink> {
  const [link] = await db.insert(donorSubjectLinks).values({
    donorId,
    subjectId,
    relationship,
    verifiedBy,
    verifiedAt: new Date(),
  }).onConflictDoUpdate({
    target: [donorSubjectLinks.donorId, donorSubjectLinks.subjectId],
    set: { relationship, verifiedBy, verifiedAt: new Date() },
  }).returning();
  return link;
}

/** Set release_on_file=true. Required before any asset is eligible for selection (§5.5). */
export async function confirmRelease(
  assetId: string,
  confirmedBy: string, // logged for audit — not stored per spec (no confirmedBy column on assets)
): Promise<void> {
  await db.update(mediaAssets)
    .set({ releaseOnFile: true })
    .where(eq(mediaAssets.id, assetId));
}

/** Set photo_consent_on_file=true. Required for linked_subject sends (§5.6). */
export async function confirmPhotoConsent(subjectId: string): Promise<void> {
  await db.update(subjects)
    .set({ photoConsentOnFile: true })
    .where(eq(subjects.id, subjectId));
}

/** Mark an asset as having no identifiable subjects (skips tagging queue). */
export async function markNoSubjects(assetId: string): Promise<void> {
  await db.update(mediaAssets)
    .set({ taggingState: 'no_subjects' })
    .where(eq(mediaAssets.id, assetId));
}
