export interface ParsedDonor {
  /** Platform-native donor/gift ID used to link gifts back to this donor row */
  externalId?: string;
  firstName: string;
  lastName: string;
  /** True when "John & Jane Smith" or similar couple pattern detected */
  isCouple?: boolean;
  email?: string;
  /** Fully normalized E.164 phone number, or undefined if unresolvable */
  phoneE164?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 */
  country?: string;
}

export interface ParsedGift {
  /** Platform-native donation ID — used for idempotent deduplication */
  externalGiftId: string;
  /** Links back to ParsedDonor.externalId */
  donorRef: string;
  /** Charge Amount × 100 — what the donor actually paid, not the matched total */
  amountCents: number;
  matchedTotalCents?: number;
  currency: string;
  /** Payment processor name, platform ID prefix stripped */
  gateway: string;
  /** Team name from the team_donations sheet join, if applicable */
  teamReferrer?: string;
  dedication?: string;
  /** 'processed' | 'failed' | 'authorized' */
  status: string;
  /** UTC Date converted from Excel serial or ISO string */
  giftedAt: Date;
  invoiceNo?: string;
}

export interface ParsedConsent {
  donorRef: string;
  channel: 'whatsapp' | 'sms' | 'email';
  state: 'opted_in';
  source: 'inferred';
}

export interface QuarantinedRow {
  rowIndex: number;
  sheet?: string;
  /** Machine-readable reason code */
  reason: string;
  /** Raw row data — stored for review, never logged */
  rawData: Record<string, unknown>;
}

export interface ParsedImport {
  donors: ParsedDonor[];
  gifts: ParsedGift[];
  consents: ParsedConsent[];
  quarantined: QuarantinedRow[];
}

export interface ImportAdapter {
  /**
   * Parse the file at filePath and return structured data.
   * This is a pure function relative to the DB — no DB calls.
   */
  parse(
    filePath: string,
    options: { campaignExternalId: string },
  ): Promise<ParsedImport>;
}

export interface ImportOptions {
  orgSlug: string;
  campaignExternalId: string;
  adapter: 'charidy' | 'causematch';
  dryRun: boolean;
}

export interface ImportSummary {
  donorsCreated: number;
  donorsUpdated: number;
  conflicts: number;
  giftsCreated: number;
  giftsSkipped: number;
  quarantined: number;
}
