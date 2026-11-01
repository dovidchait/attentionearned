// ============================================================================
// BRAND: every outbound SMS / WhatsApp / email answer starts with "Attention Earned:"
// (matches the toll-free verification samples). Kept in its own file so
// channels.js and notify.js can both use it without importing each other.
// ============================================================================

export const BRAND = 'Attention Earned:';

/** Adds the prefix once: "Attention Earned: Attention Earned: ..." never happens. */
export function brand(text) {
  const t = String(text || '').trim();
  return t.startsWith(BRAND) ? t : `${BRAND} ${t}`;
}
