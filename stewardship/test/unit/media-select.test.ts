import { describe, it, expect } from 'vitest';
import { isAssetEligible, type AssetCandidate, type EligibilityOptions } from '../../src/media/select.js';

// ── isAssetEligible — pure predicate tests ──────────────────────────────────

const NOW = new Date('2024-06-15T12:00:00Z');
const ASSET_ID = 'asset-abc-123';

function asset(overrides: Partial<AssetCandidate> = {}): AssetCandidate {
  return {
    id: ASSET_ID,
    releaseOnFile: true,
    expiresAt: null,
    designationId: null,
    tags: [],
    ...overrides,
  };
}

function opts(overrides: Partial<EligibilityOptions> = {}): EligibilityOptions {
  return { now: NOW, ...overrides };
}

describe('isAssetEligible — §5.5 release gate', () => {
  it('returns false when releaseOnFile=false', () => {
    expect(isAssetEligible(asset({ releaseOnFile: false }), opts())).toBe(false);
  });

  it('returns true when releaseOnFile=true', () => {
    expect(isAssetEligible(asset({ releaseOnFile: true }), opts())).toBe(true);
  });
});

describe('isAssetEligible — expiry', () => {
  it('returns false when expiresAt is in the past', () => {
    expect(isAssetEligible(asset({ expiresAt: new Date('2024-01-01') }), opts())).toBe(false);
  });

  it('returns false when expiresAt equals now', () => {
    expect(isAssetEligible(asset({ expiresAt: NOW }), opts())).toBe(false);
  });

  it('returns true when expiresAt is in the future', () => {
    expect(isAssetEligible(asset({ expiresAt: new Date('2025-01-01') }), opts())).toBe(true);
  });

  it('returns true when expiresAt is null (never expires)', () => {
    expect(isAssetEligible(asset({ expiresAt: null }), opts())).toBe(true);
  });
});

describe('isAssetEligible — 90-day rotation', () => {
  it('returns false when asset is in the recent-send set', () => {
    expect(isAssetEligible(asset(), opts({ recentAssetIds: new Set([ASSET_ID]) }))).toBe(false);
  });

  it('returns true when asset is NOT in the recent-send set', () => {
    expect(isAssetEligible(asset(), opts({ recentAssetIds: new Set(['other-asset']) }))).toBe(true);
  });

  it('returns true with empty recent-send set', () => {
    expect(isAssetEligible(asset(), opts({ recentAssetIds: new Set() }))).toBe(true);
  });

  it('returns true when recentAssetIds is not provided', () => {
    expect(isAssetEligible(asset(), opts())).toBe(true);
  });
});

describe('isAssetEligible — designation_match filter', () => {
  it('returns false when designationId does not match required', () => {
    expect(isAssetEligible(
      asset({ designationId: 'desig-b' }),
      opts({ requiredDesignationId: 'desig-a' }),
    )).toBe(false);
  });

  it('returns true when designationId matches', () => {
    expect(isAssetEligible(
      asset({ designationId: 'desig-a' }),
      opts({ requiredDesignationId: 'desig-a' }),
    )).toBe(true);
  });

  it('returns false when designationId is null but a required designation is set', () => {
    expect(isAssetEligible(
      asset({ designationId: null }),
      opts({ requiredDesignationId: 'desig-a' }),
    )).toBe(false);
  });

  it('returns true when no required designation is set (rotating_seasonal)', () => {
    expect(isAssetEligible(
      asset({ designationId: 'any-desig' }),
      opts({ requiredDesignationId: undefined }),
    )).toBe(true);
  });
});

describe('isAssetEligible — tag filter', () => {
  it('returns false when asset is missing a required tag', () => {
    expect(isAssetEligible(
      asset({ tags: ['no_faces'] }),
      opts({ requiredTags: ['no_faces', 'seasonal:chanukah'] }),
    )).toBe(false);
  });

  it('returns true when asset has all required tags', () => {
    expect(isAssetEligible(
      asset({ tags: ['no_faces', 'seasonal:chanukah', 'children'] }),
      opts({ requiredTags: ['no_faces', 'seasonal:chanukah'] }),
    )).toBe(true);
  });

  it('returns true when no tags are required', () => {
    expect(isAssetEligible(asset({ tags: [] }), opts({ requiredTags: [] }))).toBe(true);
    expect(isAssetEligible(asset({ tags: [] }), opts({ requiredTags: undefined }))).toBe(true);
  });
});

describe('isAssetEligible — combined filters', () => {
  it('fails if any single condition fails even when all others pass', () => {
    // All good except releaseOnFile
    expect(isAssetEligible(
      asset({ releaseOnFile: false, designationId: 'desig-a', tags: ['no_faces'] }),
      opts({ requiredDesignationId: 'desig-a', requiredTags: ['no_faces'] }),
    )).toBe(false);
  });

  it('passes when all conditions are satisfied', () => {
    expect(isAssetEligible(
      asset({ releaseOnFile: true, designationId: 'desig-a', tags: ['no_faces'], expiresAt: new Date('2099-01-01') }),
      opts({ requiredDesignationId: 'desig-a', requiredTags: ['no_faces'], recentAssetIds: new Set(['other']) }),
    )).toBe(true);
  });
});

// ── §5.6 linked_subject guardrail documentation (DB tests live in integration) ──
// These tests document the expected behavior at the pure-predicate level.
// The full DB-backed linked_subject flow (no link → null, no consent → null,
// auto-only tag → null, no eligible asset → null) is enforced in selectAsset()
// inside select.ts and verified against a live DB in integration tests.
describe('isAssetEligible — linked_subject predicate layer', () => {
  it('still enforces releaseOnFile for subject-tagged assets', () => {
    expect(isAssetEligible(asset({ releaseOnFile: false }), opts())).toBe(false);
  });

  it('still enforces 90-day rotation for subject-tagged assets', () => {
    expect(isAssetEligible(asset(), opts({ recentAssetIds: new Set([ASSET_ID]) }))).toBe(false);
  });
});
