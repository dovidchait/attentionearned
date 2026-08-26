import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  normalizePhone,
  normalizeCountry,
  normalizePostalCode,
  normalizeGateway,
  excelSerialToDate,
  stripDiacritics,
} from '../../src/ingestion/normalizer.js';

describe('normalizeName', () => {
  it('splits a standard first/last name', () => {
    const r = normalizeName('David', 'Goldstein');
    expect(r.firstName).toBe('David');
    expect(r.lastName).toBe('Goldstein');
    expect(r.isCouple).toBe(false);
  });

  it('strips Rabbi honorific', () => {
    const r = normalizeName('Rabbi David', 'Levy');
    expect(r.firstName).toBe('David');
    expect(r.isCouple).toBe(false);
  });

  it('strips Dr. honorific', () => {
    const r = normalizeName('Dr. Sarah', 'Cohen');
    expect(r.firstName).toBe('Sarah');
  });

  it('strips Mrs honorific', () => {
    const r = normalizeName('Mrs. Rebecca', 'Klein');
    expect(r.firstName).toBe('Rebecca');
  });

  it('detects married-couple name with &', () => {
    const r = normalizeName('Moshe & Leah', 'Cohen');
    expect(r.isCouple).toBe(true);
    expect(r.firstName).toBe('Moshe & Leah');
    expect(r.lastName).toBe('Cohen');
  });

  it('detects married-couple name with comma', () => {
    const r = normalizeName('John, Jane', 'Smith');
    expect(r.isCouple).toBe(true);
  });

  it('preserves Unicode NFC normalization', () => {
    const r = normalizeName('José', 'García');
    expect(r.firstName).toBe('José');
  });
});

describe('normalizePhone', () => {
  it('normalizes a valid US number from decomposed fields', () => {
    const r = normalizePhone(1, '347', '2351851');
    expect(r.e164).toBe('+13472351851');
    expect(r.failReason).toBeUndefined();
  });

  it('normalizes a valid UK number (+44)', () => {
    const r = normalizePhone(44, '7911', '123456');
    expect(r.e164).toBe('+447911123456');
  });

  it('normalizes a valid IL number (+972)', () => {
    const r = normalizePhone(972, '54', '7654321');
    expect(r.e164).toBe('+972547654321');
  });

  it('falls back to composite phone when decomposed fields are zero', () => {
    const r = normalizePhone(0, '', '', '+1 212-555-1234');
    expect(r.e164).toBe('+12125551234');
  });

  it('falls back to composite phone when decomposed fields are null', () => {
    const r = normalizePhone(null, null, null, '+1 800-555-0100');
    expect(r.e164).toBe('+18005550100');
  });

  it('returns null for an invalid number', () => {
    const r = normalizePhone(1, '000', '0000000', '+1 000-000-0000');
    expect(r.e164).toBeNull();
    expect(r.failReason).toBe('phone_unresolvable');
  });

  it('returns null when all inputs are empty', () => {
    const r = normalizePhone(null, null, null, null);
    expect(r.e164).toBeNull();
  });
});

describe('normalizeCountry', () => {
  it('maps "United States" to "US"', () => {
    expect(normalizeCountry('United States')).toBe('US');
  });

  it('maps "Canada" to "CA"', () => {
    expect(normalizeCountry('Canada')).toBe('CA');
  });

  it('returns a 2-letter code as uppercase', () => {
    expect(normalizeCountry('ca')).toBe('CA');
  });

  it('defaults to US for unknown country', () => {
    expect(normalizeCountry('Neverland')).toBe('US');
  });

  it('defaults to US for null', () => {
    expect(normalizeCountry(null)).toBe('US');
  });
});

describe('normalizePostalCode', () => {
  it('passes through a 5-digit US ZIP', () => {
    expect(normalizePostalCode('10001', 'US')).toBe('10001');
  });

  it('strips ZIP+4 to 5 digits', () => {
    expect(normalizePostalCode('10001-1234', 'US')).toBe('10001');
  });

  it('normalizes Canadian postal codes', () => {
    expect(normalizePostalCode('m5v 3c6', 'CA')).toBe('M5V3C6');
  });

  it('returns empty string for null', () => {
    expect(normalizePostalCode(null, 'US')).toBe('');
  });
});

describe('normalizeGateway', () => {
  it('strips [ID] prefix from gateway string', () => {
    expect(normalizeGateway('[46365]stripe')).toBe('stripe');
  });

  it('passes through plain gateway name', () => {
    expect(normalizeGateway('stripe')).toBe('stripe');
  });

  it('handles offline donation', () => {
    expect(normalizeGateway('offline donation')).toBe('offline donation');
  });

  it('returns empty string for null', () => {
    expect(normalizeGateway(null)).toBe('');
  });
});

describe('excelSerialToDate', () => {
  it('converts a known Excel serial to the correct UTC date', () => {
    // Excel serial 45000 = 2023-03-15 in UTC (roughly)
    // 45000 days from 1899-12-30 = 1970-01-01 + (45000-25569) days
    const date = excelSerialToDate(45000);
    expect(date).toBeInstanceOf(Date);
    // Just verify it's in the year 2023 range
    expect(date.getUTCFullYear()).toBe(2023);
  });

  it('handles a float with time component', () => {
    // 45000.5 = midday
    const date = excelSerialToDate(45000.5);
    expect(date.getUTCHours()).toBe(12);
  });

  it('throws for zero', () => {
    expect(() => excelSerialToDate(0)).toThrow();
  });

  it('throws for negative', () => {
    expect(() => excelSerialToDate(-1)).toThrow();
  });

  it('throws for a string', () => {
    expect(() => excelSerialToDate('2023-01-01')).toThrow();
  });

  it('throws for NaN', () => {
    expect(() => excelSerialToDate(NaN)).toThrow();
  });
});

describe('stripDiacritics', () => {
  it('strips accents from letters', () => {
    expect(stripDiacritics('café')).toBe('cafe');
    expect(stripDiacritics('naïve')).toBe('naive');
    expect(stripDiacritics('García')).toBe('Garcia');
  });
});
