import { describe, it, expect } from 'vitest';
import { buildDiffReport, formatDiffReport } from '../../src/ingestion/diff.js';
import type { DedupeResult } from '../../src/ingestion/deduplicator.js';
import type { ParsedGift } from '../../src/ingestion/adapter.js';

function makeResult(action: DedupeResult['action'], overrides: Partial<DedupeResult> = {}): DedupeResult {
  return {
    action,
    parsedDonor: { firstName: 'Test', lastName: 'User', externalId: 'gift-1' },
    dedupeKey: 'org:email:test@example.com',
    ...overrides,
  };
}

function makeGift(id: string): ParsedGift {
  return {
    externalGiftId: id,
    donorRef: 'gift-1',
    amountCents: 3600,
    currency: 'USD',
    gateway: 'stripe',
    status: 'processed',
    giftedAt: new Date(),
  };
}

describe('buildDiffReport', () => {
  it('categorizes creates, updates, and conflicts correctly', () => {
    const results = [
      makeResult('create'),
      makeResult('create'),
      makeResult('update', { existingDonorId: 'uuid-1', changes: { email: { old: null, new: 'a@b.com' } } }),
      makeResult('conflict', { conflictReason: 'intra_file_duplicate' }),
    ];
    const gifts = [makeGift('g1'), makeGift('g2'), makeGift('g3')];
    const existingIds = new Set(['g3']); // g3 already exists

    const report = buildDiffReport(results, gifts, existingIds, []);

    expect(report.toCreate).toHaveLength(2);
    expect(report.toUpdate).toHaveLength(1);
    expect(report.conflicts).toHaveLength(1);
    expect(report.giftsSummary.toCreate).toBe(2);
    expect(report.giftsSummary.alreadyExists).toBe(1);
    expect(report.quarantined).toHaveLength(0);
  });

  it('counts quarantined rows', () => {
    const report = buildDiffReport([], [], new Set(), [
      { rowIndex: 3, sheet: 'processed', reason: 'invalid_charge_amount', rawData: {} },
      { rowIndex: 7, sheet: 'processed', reason: 'missing_donation_id', rawData: {} },
    ]);
    expect(report.quarantined).toHaveLength(2);
  });

  it('handles empty input', () => {
    const report = buildDiffReport([], [], new Set(), []);
    expect(report.toCreate).toHaveLength(0);
    expect(report.giftsSummary.toCreate).toBe(0);
    expect(report.giftsSummary.alreadyExists).toBe(0);
  });
});

describe('formatDiffReport', () => {
  it('includes donor and gift counts in output', () => {
    const report = buildDiffReport(
      [makeResult('create'), makeResult('conflict', { conflictReason: 'intra_file_duplicate' })],
      [makeGift('g1')],
      new Set(),
      [{ rowIndex: 2, reason: 'invalid_charge_amount', rawData: {} }],
    );
    const output = formatDiffReport(report);
    expect(output).toContain('1 to create');
    expect(output).toContain('1 conflict');
    expect(output).toContain('1 to create'); // gifts
    expect(output).toContain('Quarantined: 1');
  });
});
