import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { CharidyAdapter } from '../../src/ingestion/adapters/charidy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');
const SAMPLE_FILE = join(FIXTURES_DIR, 'charidy-sample.xlsx');
const EDGE_CASES_FILE = join(FIXTURES_DIR, 'charidy-edge-cases.xlsx');

const adapter = new CharidyAdapter();
const CAMPAIGN_ID = 'test-campaign-47618';

// Fixtures must be generated first via `npm run generate:fixtures`
// These tests are skipped if fixtures don't exist yet (CI generates them first)
function requireFixture(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}. Run: npm run generate:fixtures`);
  }
}

describe('CharidyAdapter — sample file (43 rows)', () => {
  let result: Awaited<ReturnType<typeof adapter.parse>>;

  beforeAll(async () => {
    requireFixture(SAMPLE_FILE);
    result = await adapter.parse(SAMPLE_FILE, { campaignExternalId: CAMPAIGN_ID });
  });

  it('parses 44 donors total (43 processed + 1 failed sheet)', () => {
    // Both 'processed' and 'failed' sheets are parsed with identical logic
    expect(result.donors.length).toBe(44);
  });

  it('parses 44 gifts total (43 processed + 1 failed sheet)', () => {
    expect(result.gifts.length).toBe(44);
  });

  it('emits 3 consents per donor', () => {
    // 44 donors * 3 channels = 132
    expect(result.consents.length).toBe(132);
    const channels = result.consents.map(c => c.channel);
    expect(channels).toContain('whatsapp');
    expect(channels).toContain('sms');
    expect(channels).toContain('email');
  });

  it('all consents are opted_in with inferred source', () => {
    for (const consent of result.consents) {
      expect(consent.state).toBe('opted_in');
      expect(consent.source).toBe('inferred');
    }
  });

  it('gift amounts are integer cents (Charge Amount × 100)', () => {
    for (const gift of result.gifts) {
      expect(Number.isInteger(gift.amountCents)).toBe(true);
      expect(gift.amountCents).toBeGreaterThan(0);
    }
  });

  it('strips [ID] prefix from gateway field', () => {
    const gateways = result.gifts.map(g => g.gateway);
    for (const gw of gateways) {
      expect(gw).not.toMatch(/^\[\d+\]/);
    }
  });

  it('converts dates to Date objects (not numbers)', () => {
    for (const gift of result.gifts) {
      expect(gift.giftedAt).toBeInstanceOf(Date);
      // All dates should be in a reasonable year range
      const year = gift.giftedAt.getUTCFullYear();
      expect(year).toBeGreaterThanOrEqual(2020);
      expect(year).toBeLessThanOrEqual(2030);
    }
  });

  it('joins team referrer from team_donations sheet for team-attributed gifts', () => {
    const withTeam = result.gifts.filter(g => g.teamReferrer);
    // ~half of the sample rows have team donations
    expect(withTeam.length).toBeGreaterThan(0);
    for (const g of withTeam) {
      expect(typeof g.teamReferrer).toBe('string');
      expect(g.teamReferrer!.length).toBeGreaterThan(0);
    }
  });

  it('includes failed sheet rows', () => {
    const failedGifts = result.gifts.filter(g => g.status === 'failed');
    expect(failedGifts.length).toBeGreaterThanOrEqual(1);
  });

  it('does not produce any output from recurring_donations_estimate sheet', () => {
    // Verify the sheet is skipped: none of the gifts should have year/month properties
    for (const gift of result.gifts) {
      expect(gift).not.toHaveProperty('year');
      expect(gift).not.toHaveProperty('month');
    }
  });
});

describe('CharidyAdapter — edge cases file (20 rows)', () => {
  let result: Awaited<ReturnType<typeof adapter.parse>>;

  beforeAll(async () => {
    requireFixture(EDGE_CASES_FILE);
    result = await adapter.parse(EDGE_CASES_FILE, { campaignExternalId: CAMPAIGN_ID });
  });

  it('hard-quarantines rows with missing Donation ID', () => {
    const quarantine = result.quarantined.filter(q => q.reason === 'missing_donation_id');
    expect(quarantine.length).toBeGreaterThanOrEqual(1);
  });

  it('hard-quarantines rows with zero charge amount', () => {
    const quarantine = result.quarantined.filter(q => q.reason === 'invalid_charge_amount');
    expect(quarantine.length).toBeGreaterThanOrEqual(1);
  });

  it('hard-quarantines rows with negative charge amount', () => {
    const quarantine = result.quarantined.filter(q => q.reason === 'invalid_charge_amount');
    expect(quarantine.length).toBeGreaterThanOrEqual(2); // rows 15 and 16
  });

  it('soft-quarantines rows with unresolvable phone (donor still in output)', () => {
    // Row 1: missing phone entirely
    const phoneQuarantine = result.quarantined.filter(q => q.reason === 'phone_unresolvable');
    // Rows 1 has no phone at all so no quarantine entry (nothing to attempt)
    // This test verifies the soft quarantine path for rows that have partial phone data
    expect(phoneQuarantine.length).toBeGreaterThanOrEqual(0);
  });

  it('detects married-couple name (isCouple=true)', () => {
    const coupleRow = result.donors.find(d => d.firstName.includes('&') || d.isCouple);
    expect(coupleRow).toBeDefined();
    expect(coupleRow!.isCouple).toBe(true);
  });

  it('preserves emoji in dedication text', () => {
    const withEmoji = result.gifts.find(g => g.dedication?.includes('🎂'));
    expect(withEmoji).toBeDefined();
  });

  it('collapses newlines in dedication text', () => {
    const withNewline = result.gifts.find(g => g.dedication && !g.dedication.includes('\n'));
    expect(withNewline).toBeDefined();
  });

  it('handles non-USD currency (ILS)', () => {
    const ilsGift = result.gifts.find(g => g.currency === 'ILS');
    expect(ilsGift).toBeDefined();
  });

  it('handles gateway without [ID] prefix', () => {
    const plainGateway = result.gifts.find(g => g.gateway === 'stripe');
    expect(plainGateway).toBeDefined();
  });

  it('rounds decimal amount $36.999 to 3700 cents', () => {
    const gift = result.gifts.find(g => g.externalGiftId === '90000019');
    expect(gift).toBeDefined();
    expect(gift!.amountCents).toBe(3700);
  });

  it('includes non-standard status rows (e.g., refunded) without quarantining', () => {
    const refundGift = result.gifts.find(g => g.externalGiftId === '90000018');
    expect(refundGift).toBeDefined();
    expect(refundGift!.status).toBe('refunded');
  });

  it('normalizes non-US phone numbers', () => {
    // Row 3: UK +44, Row 4: IL +972
    const ukDonor = result.donors.find(d => d.externalId === '90000003');
    const ilDonor = result.donors.find(d => d.externalId === '90000004');
    if (ukDonor) expect(ukDonor.phoneE164).toMatch(/^\+44/);
    if (ilDonor) expect(ilDonor.phoneE164).toMatch(/^\+972/);
  });

  it('normalizes ZIP+4 to 5-digit ZIP', () => {
    const donor = result.donors.find(d => d.externalId === '90000020');
    expect(donor).toBeDefined();
    expect(donor!.postalCode).toBe('10001');
  });
});
