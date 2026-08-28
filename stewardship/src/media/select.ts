import { eq, and, inArray, lt, isNull, or, gt, sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import {
  mediaAssets,
  mediaAssetSubjects,
  mediaRenditions,
  donorSubjectLinks,
  subjects,
  touches,
} from '../schema/index.js';

export type AssetSelector = 'designation_match' | 'rotating_seasonal' | 'linked_subject';

export interface SelectParams {
  orgId: string;
  donorId: string;
  selector: AssetSelector;
  tags?: string[];
  designationId?: string;
  now?: Date;
}

export interface SelectedAsset {
  assetId: string;
  /** Rendition URIs keyed by channel. */
  renditions: Record<string, string>;
}

// ── Pure predicate (used by unit tests without DB) ─────────────────────────

export interface AssetCandidate {
  id: string;
  releaseOnFile: boolean;
  expiresAt: Date | null;
  designationId: string | null;
  tags: string[];
}

export interface EligibilityOptions {
  now?: Date;
  recentAssetIds?: Set<string>; // asset IDs already sent to this donor within 90 days
  requiredDesignationId?: string;
  requiredTags?: string[];
}

/**
 * Pure predicate — determines whether a candidate asset is eligible for selection.
 * No DB calls. Covers:
 *   §5.5: release_on_file required
 *   §5.5: not expired
 *   Rotation: not sent to this donor within 90 days
 *   designation_match filter
 *   tag overlap filter
 */
export function isAssetEligible(asset: AssetCandidate, opts: EligibilityOptions = {}): boolean {
  const now = opts.now ?? new Date();

  // §5.5 — hard gate: release must be on file
  if (!asset.releaseOnFile) return false;

  // Expiry check
  if (asset.expiresAt !== null && asset.expiresAt <= now) return false;

  // 90-day rotation
  if (opts.recentAssetIds?.has(asset.id)) return false;

  // Designation filter
  if (opts.requiredDesignationId !== undefined) {
    if (asset.designationId !== opts.requiredDesignationId) return false;
  }

  // Tag overlap filter (asset must have ALL required tags)
  if (opts.requiredTags && opts.requiredTags.length > 0) {
    for (const tag of opts.requiredTags) {
      if (!asset.tags.includes(tag)) return false;
    }
  }

  return true;
}

// ── DB-backed selector ──────────────────────────────────────────────────────

/**
 * Select an asset for a donor/touch, enforcing all §5.5–5.7 guardrails.
 *
 * Returns null when no eligible asset exists. For linked_subject this means
 * the step MUST be skipped — never fall back to a generic asset.
 *
 * After selection, increments usage_count and sets last_used_at on the asset.
 */
export async function selectAsset(params: SelectParams): Promise<SelectedAsset | null> {
  const now = params.now ?? new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Get asset IDs sent to this donor in the last 90 days (rotation guard)
  const recentTouches = await db
    .select({ assetId: touches.assetId })
    .from(touches)
    .where(
      and(
        eq(touches.donorId, params.donorId),
        gt(touches.sentAt, ninetyDaysAgo),
      ),
    );
  const recentAssetIds = new Set(
    recentTouches.map(t => t.assetId).filter((id): id is string => id !== null),
  );

  let assetId: string | null = null;

  if (params.selector === 'linked_subject') {
    assetId = await selectLinkedSubjectAsset(params, recentAssetIds, now);
  } else {
    assetId = await selectGeneralAsset(params, recentAssetIds, now);
  }

  if (!assetId) return null;

  // Fetch renditions
  const renditionRows = await db
    .select({ channel: mediaRenditions.channel, uri: mediaRenditions.uri })
    .from(mediaRenditions)
    .where(eq(mediaRenditions.assetId, assetId));

  const renditions: Record<string, string> = {};
  for (const r of renditionRows) {
    renditions[r.channel] = r.uri;
  }

  // Update usage stats (best-effort, non-blocking)
  db.update(mediaAssets)
    .set({ usageCount: sql`${mediaAssets.usageCount} + 1`, lastUsedAt: now })
    .where(eq(mediaAssets.id, assetId))
    .catch(() => {});

  return { assetId, renditions };
}

async function selectGeneralAsset(
  params: SelectParams,
  recentAssetIds: Set<string>,
  now: Date,
): Promise<string | null> {
  const rows = await db
    .select({ id: mediaAssets.id, releaseOnFile: mediaAssets.releaseOnFile, expiresAt: mediaAssets.expiresAt, designationId: mediaAssets.designationId, tags: mediaAssets.tags })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.orgId, params.orgId),
        eq(mediaAssets.releaseOnFile, true), // §5.5 — DB-level pre-filter
        or(isNull(mediaAssets.expiresAt), gt(mediaAssets.expiresAt, now)), // not expired
      ),
    );

  const opts: EligibilityOptions = {
    now,
    recentAssetIds,
    requiredDesignationId: params.selector === 'designation_match' ? params.designationId : undefined,
    requiredTags: params.tags,
  };

  const eligible = rows.filter(r => isAssetEligible(r as AssetCandidate, opts));
  if (eligible.length === 0) return null;

  // Random selection with uniform distribution
  return eligible[Math.floor(Math.random() * eligible.length)].id;
}

/**
 * §5.6 linked_subject selector — the highest-risk code path.
 *
 * ALL of the following must hold to return an asset:
 *   1. donor_subject_links row exists for this donor (human-verified)
 *   2. subjects.photo_consent_on_file = true for the linked subject
 *   3. media_asset_subjects row with method='human_confirmed' links the asset to the subject
 *   4. media_assets.release_on_file = true (§5.5)
 *   5. Asset not expired
 *   6. Asset not sent to this donor within 90 days
 *
 * Returns null if any condition fails. NEVER returns a fallback child.
 */
async function selectLinkedSubjectAsset(
  params: SelectParams,
  recentAssetIds: Set<string>,
  now: Date,
): Promise<string | null> {
  // 1. Find this donor's verified subject links
  const links = await db
    .select({ subjectId: donorSubjectLinks.subjectId })
    .from(donorSubjectLinks)
    .where(eq(donorSubjectLinks.donorId, params.donorId));

  if (links.length === 0) return null; // no link → skip, never fallback

  const subjectIds = links.map(l => l.subjectId);

  // 2. Filter to subjects with photo_consent_on_file = true
  const consentedSubjects = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(
        inArray(subjects.id, subjectIds),
        eq(subjects.photoConsentOnFile, true), // §5.6 required
        eq(subjects.active, true),
      ),
    );

  if (consentedSubjects.length === 0) return null; // no consent → skip

  const consentedIds = consentedSubjects.map(s => s.id);

  // 3. Find assets tagged to these subjects with method='human_confirmed' ONLY
  //    An 'auto' tag (v2 face-recog) can never gate a send — §5.6
  const taggedAssets = await db
    .select({ assetId: mediaAssetSubjects.assetId })
    .from(mediaAssetSubjects)
    .where(
      and(
        inArray(mediaAssetSubjects.subjectId, consentedIds),
        eq(mediaAssetSubjects.method, 'human_confirmed'), // §5.6 — auto tags never gate a send
      ),
    );

  if (taggedAssets.length === 0) return null;

  const taggedAssetIds = taggedAssets.map(t => t.assetId);

  // 4–6. Apply base eligibility filters
  const assetRows = await db
    .select({ id: mediaAssets.id, releaseOnFile: mediaAssets.releaseOnFile, expiresAt: mediaAssets.expiresAt, designationId: mediaAssets.designationId, tags: mediaAssets.tags })
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.id, taggedAssetIds),
        eq(mediaAssets.releaseOnFile, true), // §5.5
        or(isNull(mediaAssets.expiresAt), gt(mediaAssets.expiresAt, now)),
      ),
    );

  const eligible = assetRows.filter(a => isAssetEligible(a as AssetCandidate, { now, recentAssetIds, requiredTags: params.tags }));
  if (eligible.length === 0) return null; // nothing qualifies → skip, never fallback

  return eligible[Math.floor(Math.random() * eligible.length)].id;
}
