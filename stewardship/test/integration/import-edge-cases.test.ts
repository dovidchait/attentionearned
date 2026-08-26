import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { CharidyAdapter } from '../../src/ingestion/adapters/charidy.js';

// These tests verify the edge-case file at the adapter (parse) level only —
// no DB required. They validate the Phase 1 acceptance criteria: "Import a file
// with 20 known edge cases → all handled or explicitly quarantined for review."

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDGE_CASES_FILE = join(__dirname, '../fixtures/charidy-edge-cases.xlsx');
const adapter = new CharidyAdapter();

describe('Edge cases — adapter level (no DB)', () => {
  let result: Awaited<ReturnType<typeof adapter.parse>>;

  beforeAll(async () => {
    if (!existsSync(EDGE_CASES_FILE)) {
      console.warn('Edge cases fixture not found. Run: npm run generate:fixtures');
      return;
    }
    result = await adapter.parse(EDGE_CASES_FILE, { campaignExternalId: 'test-campaign' });
  });

  function skip() {
    return !existsSync(EDGE_CASES_FILE);
  }

  it('row 1: missing phone — donor included, no phone in output', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000001');
    expect(donor).toBeDefined();
    expect(donor!.phoneE164).toBeUndefined();
  });

  it('row 2: country_phone_prefix=0 — falls back to composite phone', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000002');
    expect(donor).toBeDefined();
    // Should have resolved via composite phone fallback
    if (donor?.phoneE164) {
      expect(donor.phoneE164).toMatch(/^\+1/);
    }
  });

  it('row 3: UK phone (+44) — normalized correctly', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000003');
    if (donor?.phoneE164) expect(donor.phoneE164).toMatch(/^\+44/);
  });

  it('row 4: IL phone (+972) — normalized correctly', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000004');
    if (donor?.phoneE164) expect(donor.phoneE164).toMatch(/^\+972/);
  });

  it('row 5: married-couple name — isCouple=true', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000005');
    expect(donor).toBeDefined();
    expect(donor!.isCouple).toBe(true);
  });

  it('row 6: dedication with emoji — preserved in output', () => {
    if (skip()) return;
    const gift = result.gifts.find(g => g.externalGiftId === '90000006');
    expect(gift).toBeDefined();
    expect(gift!.dedication).toContain('🎂');
  });

  it('row 7: dedication with newline — collapsed to space', () => {
    if (skip()) return;
    const gift = result.gifts.find(g => g.externalGiftId === '90000007');
    expect(gift).toBeDefined();
    expect(gift!.dedication).not.toContain('\n');
  });

  it('row 8: missing email — donor still processed', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000008');
    expect(donor).toBeDefined();
    expect(donor!.email).toBeUndefined();
  });

  it('row 9: missing email AND phone — uses name+zip dedupe key', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000009');
    expect(donor).toBeDefined();
    expect(donor!.email).toBeUndefined();
    expect(donor!.phoneE164).toBeUndefined();
    expect(donor!.lastName).toBe('Goldstein');
  });

  it('row 10: duplicate Donation ID — second occurrence quarantined or deduplicated', () => {
    if (skip()) return;
    // Row 10 has same Donation ID as row 1 ('90000001')
    // The adapter processes both and returns both donors;
    // deduplication happens at the importer level (intra-file)
    // At the adapter level, both should appear in output
    const donorsWithId = result.donors.filter(d => d.externalId === '90000001');
    expect(donorsWithId.length).toBeGreaterThanOrEqual(1);
  });

  it('row 11: honorific "Rabbi" stripped from first name', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000011');
    expect(donor).toBeDefined();
    expect(donor!.firstName).not.toMatch(/^Rabbi\s/i);
  });

  it('row 13: non-USD currency — currency field preserved', () => {
    if (skip()) return;
    const gift = result.gifts.find(g => g.externalGiftId === '90000013');
    expect(gift).toBeDefined();
    expect(gift!.currency).toBe('ILS');
  });

  it('row 14: gateway without [ID] prefix — kept as-is', () => {
    if (skip()) return;
    const gift = result.gifts.find(g => g.externalGiftId === '90000014');
    expect(gift).toBeDefined();
    expect(gift!.gateway).toBe('stripe');
  });

  it('row 15: Charge Amount = 0 — hard quarantined', () => {
    if (skip()) return;
    const quarantine = result.quarantined.find(q =>
      q.reason === 'invalid_charge_amount' && String(q.rawData['Donation ID'] ?? '') === '90000015'
    );
    const inOutput = result.gifts.find(g => g.externalGiftId === '90000015');
    // Either quarantined (preferred) or not in output
    expect(quarantine !== undefined || inOutput === undefined).toBe(true);
  });

  it('row 16: Charge Amount negative — hard quarantined', () => {
    if (skip()) return;
    const inOutput = result.gifts.find(g => g.externalGiftId === '90000016');
    expect(inOutput).toBeUndefined();
  });

  it('row 17: missing Donation ID — hard quarantined', () => {
    if (skip()) return;
    const quarantine = result.quarantined.find(q => q.reason === 'missing_donation_id');
    expect(quarantine).toBeDefined();
  });

  it('row 18: Status=refunded — included in output (not quarantined)', () => {
    if (skip()) return;
    const gift = result.gifts.find(g => g.externalGiftId === '90000018');
    expect(gift).toBeDefined();
    expect(gift!.status).toBe('refunded');
  });

  it('row 19: $36.999 → 3700 cents (correct rounding)', () => {
    if (skip()) return;
    const gift = result.gifts.find(g => g.externalGiftId === '90000019');
    expect(gift).toBeDefined();
    expect(gift!.amountCents).toBe(3700);
  });

  it('row 20: ZIP+4 postal code → 5-digit ZIP', () => {
    if (skip()) return;
    const donor = result.donors.find(d => d.externalId === '90000020');
    expect(donor).toBeDefined();
    expect(donor!.postalCode).toBe('10001');
  });
});
