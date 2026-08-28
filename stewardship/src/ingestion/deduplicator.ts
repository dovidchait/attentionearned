import { stripDiacritics } from './normalizer.js';
import type { ParsedDonor } from './adapter.js';

/**
 * Generate the canonical dedupe key for a donor within an org.
 * Priority: email > phone > name+zip
 * This key is also stored in donors.dedupe_key.
 */
export function generateDedupeKey(orgId: string, donor: ParsedDonor): string {
  const email = donor.email?.toLowerCase().trim();
  if (email) {
    return `${orgId}:email:${email}`;
  }

  if (donor.phoneE164) {
    return `${orgId}:phone:${donor.phoneE164}`;
  }

  const lastNorm = stripDiacritics(donor.lastName.toLowerCase().trim());
  const firstNorm = stripDiacritics(donor.firstName.toLowerCase().trim());
  const zip = donor.postalCode?.trim() ?? '';
  return `${orgId}:namzip:${lastNorm}:${firstNorm}:${zip}`;
}

export type DedupeAction = 'create' | 'update' | 'conflict';

export interface ExistingDonorStub {
  id: string;
  email?: string | null;
  phoneE164?: string | null;
  firstName: string;
  lastName: string;
  dedupeKey: string;
}

export interface FieldChange {
  old: unknown;
  new: unknown;
}

export interface DedupeResult {
  action: DedupeAction;
  parsedDonor: ParsedDonor;
  dedupeKey: string;
  /** Set when action is 'update' or 'conflict' */
  existingDonorId?: string;
  /** Non-null fields that differ from the existing record (for updates) */
  changes?: Record<string, FieldChange>;
  /** Human-readable reason (for conflicts) */
  conflictReason?: string;
}

const CRITICAL_FIELDS: Array<keyof ParsedDonor> = ['email', 'phoneE164'];

/**
 * Determine if two donor records have a critical field conflict.
 * A conflict occurs when both records have a non-null value for the same field
 * but the values disagree.
 */
function hasCriticalConflict(
  existing: ExistingDonorStub,
  incoming: ParsedDonor,
): string | null {
  if (
    existing.email &&
    incoming.email &&
    existing.email.toLowerCase() !== incoming.email.toLowerCase()
  ) {
    return 'email_mismatch';
  }
  if (
    existing.phoneE164 &&
    incoming.phoneE164 &&
    existing.phoneE164 !== incoming.phoneE164
  ) {
    return 'phone_mismatch';
  }
  return null;
}

function computeChanges(
  existing: ExistingDonorStub,
  incoming: ParsedDonor,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  const fields: Array<[string, unknown, unknown]> = [
    ['email', existing.email, incoming.email],
    ['phoneE164', existing.phoneE164, incoming.phoneE164],
    ['firstName', existing.firstName, incoming.firstName],
    ['lastName', existing.lastName, incoming.lastName],
  ];
  for (const [field, oldVal, newVal] of fields) {
    if (newVal !== undefined && newVal !== null && newVal !== oldVal) {
      changes[field] = { old: oldVal, new: newVal };
    }
  }
  return changes;
}

/**
 * Deduplicate a list of parsed donors against existing DB donors.
 * Pure function — no DB calls. Pass the pre-fetched existingByKey map.
 *
 * Also handles intra-file deduplication (two rows in the same import with the same key).
 */
export function deduplicateImport(
  orgId: string,
  parsedDonors: ParsedDonor[],
  existingByKey: Map<string, ExistingDonorStub>,
): DedupeResult[] {
  const results: DedupeResult[] = [];
  // Track keys seen within this import to catch intra-file duplicates
  const seenInFile = new Map<string, number>(); // key → result index

  for (const donor of parsedDonors) {
    const key = generateDedupeKey(orgId, donor);

    // Intra-file duplicate check
    if (seenInFile.has(key)) {
      results.push({
        action: 'conflict',
        parsedDonor: donor,
        dedupeKey: key,
        conflictReason: 'intra_file_duplicate',
      });
      continue;
    }
    seenInFile.set(key, results.length);

    // Inter-file check against existing DB donors
    const existing = existingByKey.get(key);

    if (!existing) {
      results.push({ action: 'create', parsedDonor: donor, dedupeKey: key });
      continue;
    }

    const conflictReason = hasCriticalConflict(existing, donor);
    if (conflictReason) {
      results.push({
        action: 'conflict',
        parsedDonor: donor,
        dedupeKey: key,
        existingDonorId: existing.id,
        conflictReason,
      });
      continue;
    }

    const changes = computeChanges(existing, donor);
    results.push({
      action: Object.keys(changes).length > 0 ? 'update' : 'create',
      parsedDonor: donor,
      dedupeKey: key,
      existingDonorId: existing.id,
      changes: Object.keys(changes).length > 0 ? changes : undefined,
    });
  }

  return results;
}
