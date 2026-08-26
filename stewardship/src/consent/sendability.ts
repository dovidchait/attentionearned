export type Channel = 'whatsapp' | 'sms' | 'email';

export type SendabilityReason =
  | 'ok'
  | 'send_not_enabled'   // global SEND_ENABLED=false
  | 'org_not_live'       // org.status !== 'live'
  | 'org_send_disabled'  // org.send_enabled=false
  | 'no_consent'         // no consent record for this channel
  | 'opted_out'          // consent.state !== 'opted_in'
  | 'suppressed';        // active suppression covers this channel

export interface SendabilityResult {
  sendable: boolean;
  reason: SendabilityReason;
}

export interface OrgSnapshot {
  sendEnabled: boolean;
  status: string; // 'onboarding' | 'live' | 'paused' | 'offboarded'
}

export interface ConsentSnapshot {
  channel: string;
  state: string; // 'opted_in' | 'opted_out' | 'unknown'
}

export interface SuppressionSnapshot {
  scope: string; // 'all' | 'whatsapp' | 'sms' | 'email'
  startsAt: Date;
  endsAt: Date | null; // null = permanent
}

/**
 * Pure sendability check — all inputs passed in, no DB or env calls.
 *
 * Implements guardrails §5.1, §5.3, §5.4:
 *   - Global send switch
 *   - Org status and send_enabled
 *   - Consent record (must be opted_in)
 *   - Active suppressions (scope 'all' or matching channel)
 *
 * Callers (assertSendable) are responsible for providing the correct data.
 * Tests call this directly with mock data.
 */
export function checkSendability(params: {
  channel: Channel;
  org: OrgSnapshot;
  consents: ConsentSnapshot[];
  suppressions: SuppressionSnapshot[];
  globalSendEnabled: boolean;
  now?: Date;
}): SendabilityResult {
  const { channel, org, consents, suppressions, globalSendEnabled, now = new Date() } = params;

  if (!globalSendEnabled) {
    return { sendable: false, reason: 'send_not_enabled' };
  }

  if (org.status !== 'live') {
    return { sendable: false, reason: 'org_not_live' };
  }

  if (!org.sendEnabled) {
    return { sendable: false, reason: 'org_send_disabled' };
  }

  const consent = consents.find(c => c.channel === channel);
  if (!consent) {
    return { sendable: false, reason: 'no_consent' };
  }
  if (consent.state !== 'opted_in') {
    return { sendable: false, reason: 'opted_out' };
  }

  const activeSuppression = suppressions.find(s => {
    const scopeMatches = s.scope === 'all' || s.scope === channel;
    const started = s.startsAt <= now;
    const notExpired = s.endsAt === null || s.endsAt > now;
    return scopeMatches && started && notExpired;
  });

  if (activeSuppression) {
    return { sendable: false, reason: 'suppressed' };
  }

  return { sendable: true, reason: 'ok' };
}
