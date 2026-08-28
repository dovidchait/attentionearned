import * as XLSX from 'xlsx';
import {
  normalizeName,
  normalizePhone,
  normalizeCountry,
  normalizePostalCode,
  normalizeGateway,
  excelSerialToDate,
} from '../normalizer.js';
import type {
  ImportAdapter,
  ParsedImport,
  ParsedDonor,
  ParsedGift,
  ParsedConsent,
  QuarantinedRow,
} from '../adapter.js';

const CHANNELS = ['whatsapp', 'sms', 'email'] as const;

type RawRow = Record<string, unknown>;

/** Build a Map<donationId, teamName> from the team_donations sheet */
function buildTeamReferrerMap(workbook: XLSX.WorkBook): Map<string, string> {
  const sheet = workbook.Sheets['team_donations'];
  if (!sheet) return new Map();

  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { raw: true, defval: null });
  const map = new Map<string, string>();

  for (const row of rows) {
    const donationId = String(row['Donation ID'] ?? '').trim();
    const teamName = String(row['Team Name'] ?? '').trim();
    if (donationId && teamName) {
      map.set(donationId, teamName);
    }
  }

  return map;
}

function processSheetRows(
  rows: RawRow[],
  sheetName: string,
  teamReferrerMap: Map<string, string>,
  campaignExternalId: string,
): {
  donors: ParsedDonor[];
  gifts: ParsedGift[];
  consents: ParsedConsent[];
  quarantined: QuarantinedRow[];
} {
  const donors: ParsedDonor[] = [];
  const gifts: ParsedGift[] = [];
  const consents: ParsedConsent[] = [];
  const quarantined: QuarantinedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowIndex = i + 2; // 1-indexed, +1 for header

    // ── Hard quarantine checks ────────────────────────────────────────────────

    const donationId = String(row['Donation ID'] ?? '').trim();
    if (!donationId) {
      quarantined.push({ rowIndex, sheet: sheetName, reason: 'missing_donation_id', rawData: row });
      continue;
    }

    const chargeAmountRaw = row['Charge Amount'];
    const chargeAmount = parseFloat(String(chargeAmountRaw ?? ''));
    if (isNaN(chargeAmount) || chargeAmount <= 0) {
      quarantined.push({ rowIndex, sheet: sheetName, reason: 'invalid_charge_amount', rawData: row });
      continue;
    }

    const amountCents = Math.round(chargeAmount * 100);

    // ── Date conversion ───────────────────────────────────────────────────────

    let giftedAt: Date;
    try {
      giftedAt = excelSerialToDate(row['Donation Date and Time']);
    } catch {
      quarantined.push({ rowIndex, sheet: sheetName, reason: 'invalid_date', rawData: row });
      continue;
    }

    // ── Name normalization ────────────────────────────────────────────────────

    const rawFirst = String(row['Billing First Name'] ?? '').trim();
    const rawLast = String(row['Billing Last Name'] ?? '').trim();

    if (!rawFirst && !rawLast) {
      quarantined.push({ rowIndex, sheet: sheetName, reason: 'missing_name', rawData: row });
      continue;
    }

    const { firstName, lastName, isCouple } = normalizeName(rawFirst || 'Unknown', rawLast || 'Unknown');

    // ── Email ─────────────────────────────────────────────────────────────────

    const email = String(row['Email'] ?? '').toLowerCase().trim() || undefined;

    // ── Phone ─────────────────────────────────────────────────────────────────

    const countryPrefix = row['country_phone_prefix'];
    const areaPrefix = row['area_phone_prefix'];
    const localNumber = row['phone_number'];
    const compositePhone = String(row['Phone'] ?? '').trim() || undefined;

    const phoneResult = normalizePhone(
      countryPrefix as number | string | null,
      areaPrefix as string | number | null,
      localNumber as string | number | null,
      compositePhone,
    );

    // Soft quarantine: include donor/gift but flag as phone_unresolvable
    const phoneQuarantine = !phoneResult.e164 && (countryPrefix || areaPrefix || localNumber || compositePhone);
    if (phoneQuarantine) {
      quarantined.push({
        rowIndex,
        sheet: sheetName,
        reason: 'phone_unresolvable',
        rawData: { donationId }, // minimal — never log full row
      });
    }

    // ── Address ───────────────────────────────────────────────────────────────

    const rawCountry = String(row['Billing Address Country'] ?? '').trim();
    const country = normalizeCountry(rawCountry || null);
    const rawPostal = String(row['Billing Address Zip / Postal Code'] ?? '').trim();
    const postalCode = normalizePostalCode(rawPostal || null, country);

    const parsedDonor: ParsedDonor = {
      externalId: donationId,
      firstName,
      lastName,
      isCouple,
      email,
      phoneE164: phoneResult.e164 ?? undefined,
      addressLine1: String(row['Billing Address Line 1'] ?? '').trim() || undefined,
      addressLine2: String(row['Billing Address Line 2'] ?? '').trim() || undefined,
      city: String(row['Billing Address City'] ?? '').trim() || undefined,
      state: String(row['Billing Address State / Area'] ?? '').trim() || undefined,
      postalCode: postalCode || undefined,
      country,
    };

    // ── Gift ──────────────────────────────────────────────────────────────────

    const rawMatchedTotal = row['Matched/Total Amount'];
    const matchedTotalCents = rawMatchedTotal
      ? Math.round(parseFloat(String(rawMatchedTotal)) * 100)
      : undefined;

    const rawGateway = String(row['gateway'] ?? '').trim();
    const gateway = normalizeGateway(rawGateway) || 'unknown';

    const status = String(row['Status'] ?? '').trim().toLowerCase();
    const currency = String(row['Currency'] ?? 'USD').toUpperCase().trim();

    // Normalize dedication — preserve emoji, collapse newlines
    let dedication = String(row['Dedication'] ?? '').trim();
    if (dedication) {
      dedication = dedication.replace(/\r?\n/g, ' ').trim();
    }

    const parsedGift: ParsedGift = {
      externalGiftId: donationId,
      donorRef: donationId,
      amountCents,
      matchedTotalCents,
      currency,
      gateway,
      teamReferrer: teamReferrerMap.get(donationId),
      dedication: dedication || undefined,
      status,
      giftedAt,
      invoiceNo: String(row['Invoice No.'] ?? '').trim() || undefined,
    };

    // ── Consents ──────────────────────────────────────────────────────────────
    // All imported Charidy donors are treated as opted_in for all 3 channels
    // (inferred from completing a campaign donation). See CLAUDE.md.
    const donorConsents: ParsedConsent[] = CHANNELS.map(channel => ({
      donorRef: donationId,
      channel,
      state: 'opted_in' as const,
      source: 'inferred' as const,
    }));

    donors.push(parsedDonor);
    gifts.push(parsedGift);
    consents.push(...donorConsents);
  }

  return { donors, gifts, consents, quarantined };
}

export class CharidyAdapter implements ImportAdapter {
  async parse(
    filePath: string,
    options: { campaignExternalId: string },
  ): Promise<ParsedImport> {
    const workbook = XLSX.readFile(filePath, { type: 'file' });

    // Step 1: Build team referrer lookup
    const teamReferrerMap = buildTeamReferrerMap(workbook);

    const allDonors: ParsedDonor[] = [];
    const allGifts: ParsedGift[] = [];
    const allConsents: ParsedConsent[] = [];
    const allQuarantined: QuarantinedRow[] = [];

    // Step 2: Process 'processed' and 'failed' sheets with identical logic
    for (const sheetName of ['processed', 'failed']) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { raw: true, defval: null });
      const result = processSheetRows(rows, sheetName, teamReferrerMap, options.campaignExternalId);

      allDonors.push(...result.donors);
      allGifts.push(...result.gifts);
      allConsents.push(...result.consents);
      allQuarantined.push(...result.quarantined);
    }

    // recurring_donations_estimate sheet is intentionally skipped

    return {
      donors: allDonors,
      gifts: allGifts,
      consents: allConsents,
      quarantined: allQuarantined,
    };
  }
}
