import { db, pool } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { donors, consents, gifts } from '../schema/index.js';
import { findOrgBySlug } from '../models/org.js';
import { findCampaignByExternalId } from '../models/campaign.js';
import { getAllDonorsByOrg } from '../models/donor.js';
import { getExistingGiftExternalIds } from '../models/gift.js';
import { CharidyAdapter } from './adapters/charidy.js';
import { CausematchAdapter } from './adapters/causematch.js';
import { deduplicateImport, generateDedupeKey, type ExistingDonorStub } from './deduplicator.js';
import { buildDiffReport, formatDiffReport } from './diff.js';
import type { ImportOptions, ImportSummary, ImportAdapter } from './adapter.js';
import { eq, and } from 'drizzle-orm';

const ADAPTERS: Record<string, ImportAdapter> = {
  charidy: new CharidyAdapter(),
  causematch: new CausematchAdapter(),
};

export async function runImport(filePath: string, options: ImportOptions): Promise<ImportSummary> {
  const log = logger.child({ fn: 'runImport', adapter: options.adapter });

  const adapter = ADAPTERS[options.adapter];
  if (!adapter) {
    throw new Error(`Unknown adapter: ${options.adapter}. Valid options: ${Object.keys(ADAPTERS).join(', ')}`);
  }

  // ── Resolve org ────────────────────────────────────────────────────────────

  const org = await findOrgBySlug(options.orgSlug);
  if (!org) {
    throw new Error(`Org not found: ${options.orgSlug}`);
  }

  log.info({ orgId: org.id }, 'Starting import');

  // ── Parse the file ─────────────────────────────────────────────────────────

  const parsed = await adapter.parse(filePath, { campaignExternalId: options.campaignExternalId });
  log.info({ donors: parsed.donors.length, gifts: parsed.gifts.length, quarantined: parsed.quarantined.length }, 'File parsed');

  // ── Resolve campaign ───────────────────────────────────────────────────────

  const campaign = await findCampaignByExternalId(org.id, options.campaignExternalId);
  if (!campaign) {
    throw new Error(
      `Campaign not found for org "${options.orgSlug}" with external ID "${options.campaignExternalId}". ` +
      `Create it in the DB first or check the --campaign argument.`,
    );
  }

  // ── Build existing-donor lookup map ────────────────────────────────────────

  const existingDonors = await getAllDonorsByOrg(org.id);
  const existingByKey = new Map<string, ExistingDonorStub>(
    existingDonors.map(d => [
      d.dedupeKey,
      {
        id: d.id,
        email: d.email,
        phoneE164: d.phoneE164,
        firstName: d.firstName,
        lastName: d.lastName,
        dedupeKey: d.dedupeKey,
      },
    ]),
  );

  // ── Deduplicate ────────────────────────────────────────────────────────────

  const dedupeResults = deduplicateImport(org.id, parsed.donors, existingByKey);

  // ── Gift dedup ─────────────────────────────────────────────────────────────

  const existingGiftIds = await getExistingGiftExternalIds(org.id, options.adapter);

  // ── Build and print diff report ────────────────────────────────────────────

  const report = buildDiffReport(dedupeResults, parsed.gifts, existingGiftIds, parsed.quarantined);
  process.stdout.write(formatDiffReport(report));

  if (options.dryRun) {
    return {
      donorsCreated: report.toCreate.length,
      donorsUpdated: report.toUpdate.length,
      conflicts: report.conflicts.length,
      giftsCreated: report.giftsSummary.toCreate,
      giftsSkipped: report.giftsSummary.alreadyExists,
      quarantined: report.quarantined.length,
    };
  }

  // ── Commit to DB in a single transaction ───────────────────────────────────

  // Build a donor externalId → DB id map (populated as we insert)
  const donorExternalToDbId = new Map<string, string>();

  // Pre-populate with existing donors that are being updated
  for (const result of dedupeResults) {
    if (result.action !== 'create' && result.existingDonorId && result.parsedDonor.externalId) {
      donorExternalToDbId.set(result.parsedDonor.externalId, result.existingDonorId);
    }
  }

  await db.transaction(async (tx) => {
    // Insert/update donors
    for (const result of dedupeResults) {
      const d = result.parsedDonor;
      if (result.action === 'create') {
        const [inserted] = await tx
          .insert(donors)
          .values({
            orgId: org.id,
            firstName: d.firstName,
            lastName: d.lastName,
            email: d.email,
            phoneE164: d.phoneE164,
            addressLine1: d.addressLine1,
            addressLine2: d.addressLine2,
            city: d.city,
            region: d.state,
            postalCode: d.postalCode,
            country: d.country,
            dedupeKey: result.dedupeKey,
            ladderStage: 'new',
          })
          .returning();
        if (inserted && d.externalId) {
          donorExternalToDbId.set(d.externalId, inserted.id);
        }
      } else if (result.action === 'update' && result.existingDonorId) {
        const changes = result.changes ?? {};
        const updateData: Record<string, unknown> = {};
        if ('email' in changes) updateData['email'] = changes['email']!.new;
        if ('phoneE164' in changes) updateData['phoneE164'] = changes['phoneE164']!.new;
        if ('firstName' in changes) updateData['firstName'] = changes['firstName']!.new;
        if ('lastName' in changes) updateData['lastName'] = changes['lastName']!.new;
        if (Object.keys(updateData).length > 0) {
          await tx.update(donors)
            .set({ ...updateData, updatedAt: new Date() })
            .where(eq(donors.id, result.existingDonorId));
        }
        if (d.externalId) {
          donorExternalToDbId.set(d.externalId, result.existingDonorId);
        }
      }
      // 'conflict' action: skip — surface in diff report only
    }

    // Upsert consents (3 per donor)
    for (const consent of parsed.consents) {
      const donorDbId = donorExternalToDbId.get(consent.donorRef);
      if (!donorDbId) continue; // donor was a conflict or quarantined

      await tx
        .insert(consents)
        .values({
          donorId: donorDbId,
          channel: consent.channel,
          state: consent.state,
          source: consent.source,
        })
        .onConflictDoNothing(); // don't overwrite manual or higher-trust consent records
    }

    // Insert new gifts
    for (const gift of parsed.gifts) {
      if (existingGiftIds.has(gift.externalGiftId)) continue;

      const donorDbId = donorExternalToDbId.get(gift.donorRef);
      if (!donorDbId) continue;

      await tx
        .insert(gifts)
        .values({
          orgId: org.id,
          donorId: donorDbId,
          campaignId: campaign.id,
          amountCents: gift.amountCents,
          matchedTotalCents: gift.matchedTotalCents,
          currency: gift.currency,
          gateway: gift.gateway,
          teamReferrer: gift.teamReferrer,
          dedicationText: gift.dedication,
          status: gift.status,
          platform: options.adapter,
          externalId: gift.externalGiftId,
          occurredAt: gift.giftedAt,
        })
        .onConflictDoNothing();
    }
  });

  log.info('Import committed');

  return {
    donorsCreated: report.toCreate.length,
    donorsUpdated: report.toUpdate.length,
    conflicts: report.conflicts.length,
    giftsCreated: report.giftsSummary.toCreate,
    giftsSkipped: report.giftsSummary.alreadyExists,
    quarantined: report.quarantined.length,
  };
}
