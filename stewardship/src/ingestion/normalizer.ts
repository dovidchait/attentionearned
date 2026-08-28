import { parsePhoneNumber, type ParseError } from 'libphonenumber-js';

// Honorifics to strip from the beginning of first names
const HONORIFICS = [
  'rabbi', 'rav', 'rebbetzin', 'rebetzin', 'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.',
  'ms', 'ms.', 'prof', 'prof.', 'rev', 'cantor', 'hazzan',
];

const COUPLE_PATTERN = /\s*[&,]\s*/;

// Maps full country names and common variants to ISO 3166-1 alpha-2
const COUNTRY_MAP: Record<string, string> = {
  'united states': 'US',
  'united states of america': 'US',
  'usa': 'US',
  'u.s.a.': 'US',
  'u.s.': 'US',
  'canada': 'CA',
  'israel': 'IL',
  'united kingdom': 'GB',
  'uk': 'GB',
  'great britain': 'GB',
  'england': 'GB',
  'australia': 'AU',
  'south africa': 'ZA',
  'france': 'FR',
  'germany': 'DE',
  'switzerland': 'CH',
  'belgium': 'BE',
  'netherlands': 'NL',
  'mexico': 'MX',
  'brazil': 'BR',
  'argentina': 'AR',
};

export interface NormalizedName {
  firstName: string;
  lastName: string;
  isCouple: boolean;
}

export function normalizeName(rawFirst: string, rawLast: string): NormalizedName {
  let first = rawFirst.trim().normalize('NFC');
  let last = rawLast.trim().normalize('NFC');

  // Strip leading honorifics from first name
  const firstLower = first.toLowerCase();
  for (const honorific of HONORIFICS) {
    if (firstLower === honorific) {
      first = '';
      break;
    }
    if (firstLower.startsWith(honorific + ' ') || firstLower.startsWith(honorific + '.')) {
      first = first.slice(honorific.length).replace(/^\.?\s+/, '');
      break;
    }
  }

  // Detect married-couple pattern in first name: "John & Jane" or "Moshe, Leah"
  const isCouple = COUPLE_PATTERN.test(first);

  return {
    firstName: first || rawFirst.trim().normalize('NFC'), // fallback to original if stripped to empty
    lastName: last,
    isCouple,
  };
}

export interface PhoneResult {
  e164: string | null;
  /** Human-readable reason if e164 is null */
  failReason?: string;
}

/**
 * Reconstruct and normalize a phone number to E.164.
 * Priority:
 *   1. Use decomposed fields (countryPrefix + areaPrefix + localNumber)
 *   2. Fall back to composite phone string
 */
export function normalizePhone(
  countryPrefix: number | string | null | undefined,
  areaPrefix: string | number | null | undefined,
  localNumber: string | number | null | undefined,
  compositePhone?: string | null,
): PhoneResult {
  // Try decomposed reconstruction first
  const country = Number(countryPrefix);
  const area = String(areaPrefix ?? '').trim().replace(/\D/g, '');
  const local = String(localNumber ?? '').trim().replace(/\D/g, '');

  if (country > 0 && area.length > 0 && local.length > 0) {
    const reconstructed = `+${country}${area}${local}`;
    try {
      const parsed = parsePhoneNumber(reconstructed);
      if (parsed.isValid()) {
        return { e164: parsed.format('E.164') };
      }
    } catch {
      // fall through to composite
    }
  }

  // Try composite phone string
  if (compositePhone) {
    const cleaned = compositePhone.trim();
    if (cleaned) {
      try {
        const parsed = parsePhoneNumber(cleaned, 'US');
        if (parsed.isValid()) {
          return { e164: parsed.format('E.164') };
        }
      } catch {
        // fall through
      }
    }
  }

  return { e164: null, failReason: 'phone_unresolvable' };
}

/**
 * Convert an Excel serial date (days since 1899-12-30) to a UTC Date.
 * Throws if the value is not a number or is out of a reasonable range.
 */
export function excelSerialToDate(serial: unknown): Date {
  if (typeof serial !== 'number' || !isFinite(serial) || serial < 1 || serial > 200_000) {
    throw new Error(`Invalid Excel serial date value: ${serial}`);
  }
  // Excel epoch: 1899-12-30 = Unix -2209161600000 ms
  const EXCEL_EPOCH_OFFSET_DAYS = 25569; // days from 1899-12-30 to 1970-01-01
  return new Date((serial - EXCEL_EPOCH_OFFSET_DAYS) * 86400 * 1000);
}

export function normalizeCountry(raw: string | null | undefined): string {
  if (!raw) return 'US';
  const trimmed = raw.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const mapped = COUNTRY_MAP[trimmed.toLowerCase()];
  if (mapped) return mapped;
  // Unknown — log at call site, return 'US' as fallback
  return 'US';
}

export function normalizePostalCode(raw: string | null | undefined, country: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (country === 'US') {
    // Strip ZIP+4 if present
    return trimmed.replace(/^(\d{5})-?\d{4}$/, '$1').slice(0, 5);
  }
  if (country === 'CA') {
    return trimmed.toUpperCase().replace(/\s+/g, '');
  }
  return trimmed.toUpperCase();
}

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Strip the [ID] prefix from Charidy gateway strings: "[46365]stripe" → "stripe" */
export function normalizeGateway(raw: string | null | undefined): string {
  if (!raw) return '';
  const match = raw.match(/^\[(\d+)\](.+)$/);
  return match ? match[2]!.trim() : raw.trim();
}
