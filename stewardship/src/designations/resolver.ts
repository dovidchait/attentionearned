export interface DesignationData {
  unitAmountCents: number;
  unitNounSingular: string;
  unitNounPlural: string;
  impactPhrase: string;
}

export interface AttributionResult {
  units: number;
  unitNoun: string;
  impactPhrase: string;
  // e.g. "3 siddurim"
  formattedAttribution: string;
}

/**
 * Resolves how many whole units a gift amount covers for a given designation.
 * Example: $54 gift (5400¢) against siddur (1800¢) → 3 siddurim.
 *
 * Returns units=0 when amountCents < unitAmountCents (gift doesn't cover even one unit).
 */
export function resolveAttribution(
  amountCents: number,
  designation: DesignationData,
): AttributionResult {
  if (amountCents < 0) throw new RangeError('amountCents must be non-negative');
  if (designation.unitAmountCents <= 0) throw new RangeError('unitAmountCents must be positive');

  const units = Math.floor(amountCents / designation.unitAmountCents);
  const unitNoun = units === 1 ? designation.unitNounSingular : designation.unitNounPlural;

  return {
    units,
    unitNoun,
    impactPhrase: designation.impactPhrase,
    formattedAttribution: `${units} ${unitNoun}`,
  };
}

/**
 * Formats a partial-gift attribution when the donor doesn't cover a full unit.
 * Returns a fractional description for use in copy, e.g. "part of a siddur."
 */
export function resolvePartialAttribution(
  amountCents: number,
  designation: DesignationData,
): string {
  if (amountCents <= 0 || amountCents >= designation.unitAmountCents) {
    throw new RangeError('resolvePartialAttribution only applies when 0 < amount < unitAmount');
  }
  return `part of a ${designation.unitNounSingular}`;
}
