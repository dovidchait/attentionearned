import { describe, it, expect } from 'vitest';
import { resolveAttribution, resolvePartialAttribution } from '../../src/designations/resolver.js';

const SIDDUR = {
  unitAmountCents: 1800,
  unitNounSingular: 'siddur',
  unitNounPlural: 'siddurim',
  impactPhrase: "put a siddur in a child's hands",
};

describe('resolveAttribution', () => {
  it('$54 against siddur → 3 siddurim (spec acceptance criterion)', () => {
    const result = resolveAttribution(5400, SIDDUR);
    expect(result.units).toBe(3);
    expect(result.unitNoun).toBe('siddurim');
    expect(result.formattedAttribution).toBe('3 siddurim');
    expect(result.impactPhrase).toBe("put a siddur in a child's hands");
  });

  it('exactly 1 unit → singular noun', () => {
    const result = resolveAttribution(1800, SIDDUR);
    expect(result.units).toBe(1);
    expect(result.unitNoun).toBe('siddur');
    expect(result.formattedAttribution).toBe('1 siddur');
  });

  it('amount less than one unit → 0 units (plural)', () => {
    const result = resolveAttribution(1000, SIDDUR);
    expect(result.units).toBe(0);
    expect(result.unitNoun).toBe('siddurim'); // 0 → plural
    expect(result.formattedAttribution).toBe('0 siddurim');
  });

  it('remainder is floored — $100 → 5 siddurim (not 5.55)', () => {
    const result = resolveAttribution(10000, SIDDUR);
    expect(result.units).toBe(5); // floor(10000/1800) = 5
  });

  it('$0 gift → 0 units', () => {
    const result = resolveAttribution(0, SIDDUR);
    expect(result.units).toBe(0);
  });

  it('exact multiple → correct count', () => {
    const result = resolveAttribution(9000, SIDDUR); // 9000/1800=5
    expect(result.units).toBe(5);
  });

  it('large gift → correct count', () => {
    const result = resolveAttribution(180000, SIDDUR); // $1800 → 100 siddurim
    expect(result.units).toBe(100);
  });

  it('throws for negative amountCents', () => {
    expect(() => resolveAttribution(-100, SIDDUR)).toThrow(RangeError);
  });

  it('throws for zero unitAmountCents', () => {
    expect(() => resolveAttribution(5400, { ...SIDDUR, unitAmountCents: 0 })).toThrow(RangeError);
  });

  it('works with a different designation (sefer torah)', () => {
    const seferTorah = {
      unitAmountCents: 180000,
      unitNounSingular: 'sefer Torah',
      unitNounPlural: 'sifrei Torah',
      impactPhrase: 'write a letter in a sefer Torah',
    };
    const result = resolveAttribution(360000, seferTorah);
    expect(result.units).toBe(2);
    expect(result.formattedAttribution).toBe('2 sifrei Torah');
  });
});

describe('resolvePartialAttribution', () => {
  it('returns "part of a siddur" for partial amounts', () => {
    expect(resolvePartialAttribution(900, SIDDUR)).toBe('part of a siddur');
  });

  it('throws when amount equals or exceeds unit amount', () => {
    expect(() => resolvePartialAttribution(1800, SIDDUR)).toThrow(RangeError);
    expect(() => resolvePartialAttribution(5400, SIDDUR)).toThrow(RangeError);
  });

  it('throws for zero amount', () => {
    expect(() => resolvePartialAttribution(0, SIDDUR)).toThrow(RangeError);
  });
});
