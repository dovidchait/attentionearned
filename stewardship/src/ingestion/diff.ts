import type { DedupeResult } from './deduplicator.js';
import type { ParsedGift, QuarantinedRow } from './adapter.js';

export interface DiffReport {
  toCreate: DedupeResult[];
  toUpdate: DedupeResult[];
  conflicts: DedupeResult[];
  quarantined: QuarantinedRow[];
  giftsSummary: {
    toCreate: number;
    alreadyExists: number;
  };
}

export function buildDiffReport(
  dedupeResults: DedupeResult[],
  parsedGifts: ParsedGift[],
  existingGiftExternalIds: Set<string>,
  quarantined: QuarantinedRow[],
): DiffReport {
  const toCreate = dedupeResults.filter(r => r.action === 'create');
  const toUpdate = dedupeResults.filter(r => r.action === 'update');
  const conflicts = dedupeResults.filter(r => r.action === 'conflict');

  let giftsToCreate = 0;
  let giftsAlreadyExist = 0;

  for (const gift of parsedGifts) {
    if (existingGiftExternalIds.has(gift.externalGiftId)) {
      giftsAlreadyExist++;
    } else {
      giftsToCreate++;
    }
  }

  return {
    toCreate,
    toUpdate,
    conflicts,
    quarantined,
    giftsSummary: {
      toCreate: giftsToCreate,
      alreadyExists: giftsAlreadyExist,
    },
  };
}

export function formatDiffReport(report: DiffReport): string {
  const lines: string[] = [
    '',
    '── Import Preview ──────────────────────────────',
    `  Donors:  ${report.toCreate.length} to create, ${report.toUpdate.length} to update, ${report.conflicts.length} conflict(s)`,
    `  Gifts:   ${report.giftsSummary.toCreate} to create, ${report.giftsSummary.alreadyExists} already exist`,
    `  Quarantined: ${report.quarantined.length} row(s)`,
  ];

  if (report.conflicts.length > 0) {
    lines.push('', 'Conflicts:');
    for (const c of report.conflicts) {
      const donor = c.parsedDonor;
      lines.push(
        `  ${donor.firstName} ${donor.lastName} (key: ${c.dedupeKey}) — ${c.conflictReason}` +
        (c.existingDonorId ? ` — existing donor ID: ${c.existingDonorId}` : ''),
      );
    }
  }

  if (report.quarantined.length > 0) {
    lines.push('', 'Quarantined rows:');
    for (const q of report.quarantined) {
      lines.push(`  Sheet: ${q.sheet ?? 'unknown'}, Row ${q.rowIndex}: ${q.reason}`);
    }
  }

  if (report.toUpdate.length > 0) {
    lines.push('', 'Updates (fields changing):');
    for (const u of report.toUpdate) {
      const changes = Object.entries(u.changes ?? {})
        .map(([field, { old: o, new: n }]) => `${field}: "${o}" → "${n}"`)
        .join(', ');
      lines.push(`  Donor ID ${u.existingDonorId}: ${changes}`);
    }
  }

  lines.push('────────────────────────────────────────────', '');
  return lines.join('\n');
}
