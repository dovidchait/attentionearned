import { describe, it, expect } from 'vitest';
import { checkSendability, type OrgSnapshot, type ConsentSnapshot, type SuppressionSnapshot } from '../../src/consent/sendability.js';

// §5.3–5.4 guardrail coverage

const LIVE_ORG: OrgSnapshot = { sendEnabled: true, status: 'live' };

const OPTED_IN = (channel: string): ConsentSnapshot => ({ channel, state: 'opted_in' });
const ALL_CONSENTS: ConsentSnapshot[] = [
  OPTED_IN('whatsapp'),
  OPTED_IN('sms'),
  OPTED_IN('email'),
];
const NO_SUPPRESSIONS: SuppressionSnapshot[] = [];

function params(overrides?: Partial<Parameters<typeof checkSendability>[0]>) {
  return {
    channel: 'whatsapp' as const,
    org: LIVE_ORG,
    consents: ALL_CONSENTS,
    suppressions: NO_SUPPRESSIONS,
    globalSendEnabled: true,
    ...overrides,
  };
}

describe('checkSendability — §5.1 global send switch', () => {
  it('returns send_not_enabled when globalSendEnabled=false', () => {
    const result = checkSendability(params({ globalSendEnabled: false }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('send_not_enabled');
  });

  it('proceeds past global switch when globalSendEnabled=true', () => {
    const result = checkSendability(params({ globalSendEnabled: true }));
    expect(result.sendable).toBe(true);
    expect(result.reason).toBe('ok');
  });
});

describe('checkSendability — §5.1 org status', () => {
  it('returns org_not_live when org status is onboarding', () => {
    const result = checkSendability(params({ org: { sendEnabled: true, status: 'onboarding' } }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('org_not_live');
  });

  it('returns org_not_live when org status is paused', () => {
    const result = checkSendability(params({ org: { sendEnabled: true, status: 'paused' } }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('org_not_live');
  });

  it('returns org_not_live when org status is offboarded', () => {
    const result = checkSendability(params({ org: { sendEnabled: true, status: 'offboarded' } }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('org_not_live');
  });

  it('passes when org status is live', () => {
    const result = checkSendability(params({ org: { sendEnabled: true, status: 'live' } }));
    expect(result.sendable).toBe(true);
  });
});

describe('checkSendability — §5.1 org send_enabled', () => {
  it('returns org_send_disabled when org.sendEnabled=false', () => {
    const result = checkSendability(params({ org: { sendEnabled: false, status: 'live' } }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('org_send_disabled');
  });
});

describe('checkSendability — §5.3 consent check', () => {
  it('returns no_consent when there is no consent record for the channel', () => {
    const result = checkSendability(params({ consents: [] }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('no_consent');
  });

  it('returns no_consent when consent exists for other channels but not the target', () => {
    const result = checkSendability(params({
      channel: 'whatsapp',
      consents: [OPTED_IN('sms'), OPTED_IN('email')],
    }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('no_consent');
  });

  it('returns opted_out when consent.state is opted_out', () => {
    const result = checkSendability(params({
      consents: [{ channel: 'whatsapp', state: 'opted_out' }],
    }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('opted_out');
  });

  it('returns opted_out when consent.state is unknown', () => {
    const result = checkSendability(params({
      consents: [{ channel: 'whatsapp', state: 'unknown' }],
    }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('opted_out');
  });

  it('passes with opted_in consent', () => {
    const result = checkSendability(params({ consents: [OPTED_IN('whatsapp')] }));
    expect(result.sendable).toBe(true);
  });
});

describe('checkSendability — §5.3/5.4 suppression check', () => {
  const NOW = new Date('2024-06-15T12:00:00Z');

  it('returns suppressed for scope=all suppression', () => {
    const sup: SuppressionSnapshot = {
      scope: 'all',
      startsAt: new Date('2024-06-01T00:00:00Z'),
      endsAt: null, // permanent
    };
    const result = checkSendability(params({ suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('suppressed');
  });

  it('returns suppressed for channel-scoped suppression matching the target channel', () => {
    const sup: SuppressionSnapshot = {
      scope: 'whatsapp',
      startsAt: new Date('2024-06-01T00:00:00Z'),
      endsAt: null,
    };
    const result = checkSendability(params({ channel: 'whatsapp', suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('suppressed');
  });

  it('does NOT suppress when channel-scoped suppression is for a different channel', () => {
    const sup: SuppressionSnapshot = {
      scope: 'sms', // suppressed from SMS, not WhatsApp
      startsAt: new Date('2024-06-01T00:00:00Z'),
      endsAt: null,
    };
    const result = checkSendability(params({ channel: 'whatsapp', suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(true);
  });

  it('does NOT suppress when suppression has not started yet', () => {
    const sup: SuppressionSnapshot = {
      scope: 'all',
      startsAt: new Date('2024-07-01T00:00:00Z'), // future
      endsAt: null,
    };
    const result = checkSendability(params({ suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(true);
  });

  it('does NOT suppress when temporary suppression has expired', () => {
    const sup: SuppressionSnapshot = {
      scope: 'all',
      startsAt: new Date('2024-05-01T00:00:00Z'),
      endsAt: new Date('2024-06-01T00:00:00Z'), // expired before NOW
    };
    const result = checkSendability(params({ suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(true);
  });

  it('suppresses within a temporary window (shiva hold)', () => {
    const sup: SuppressionSnapshot = {
      scope: 'all',
      startsAt: new Date('2024-06-10T00:00:00Z'),
      endsAt: new Date('2024-06-20T00:00:00Z'), // active during NOW
    };
    const result = checkSendability(params({ suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('suppressed');
  });

  it('returns suppressed for permanent suppression (permanent opt-out)', () => {
    const sup: SuppressionSnapshot = {
      scope: 'all',
      startsAt: new Date('2024-01-01T00:00:00Z'),
      endsAt: null, // permanent — only a human may reverse (§5.4)
    };
    const result = checkSendability(params({ suppressions: [sup], now: NOW }));
    expect(result.sendable).toBe(false);
    expect(result.reason).toBe('suppressed');
  });
});

describe('checkSendability — check ordering / short-circuit', () => {
  it('global switch checked before org status (send_not_enabled wins)', () => {
    const result = checkSendability(params({
      globalSendEnabled: false,
      org: { sendEnabled: true, status: 'onboarding' }, // would also fail
    }));
    expect(result.reason).toBe('send_not_enabled');
  });

  it('org status checked before send_enabled (org_not_live wins)', () => {
    const result = checkSendability(params({
      org: { sendEnabled: false, status: 'paused' }, // both fail
    }));
    expect(result.reason).toBe('org_not_live');
  });

  it('org send_enabled checked before consent (org_send_disabled wins)', () => {
    const result = checkSendability(params({
      org: { sendEnabled: false, status: 'live' },
      consents: [], // would also fail
    }));
    expect(result.reason).toBe('org_send_disabled');
  });

  it('consent checked before suppression (no_consent wins)', () => {
    const sup: SuppressionSnapshot = { scope: 'all', startsAt: new Date(0), endsAt: null };
    const result = checkSendability(params({
      consents: [],
      suppressions: [sup],
    }));
    expect(result.reason).toBe('no_consent');
  });
});

describe('checkSendability — all three channels', () => {
  for (const channel of ['whatsapp', 'sms', 'email'] as const) {
    it(`channel=${channel}: ok when all conditions met`, () => {
      const result = checkSendability(params({ channel, consents: [OPTED_IN(channel)] }));
      expect(result.sendable).toBe(true);
      expect(result.reason).toBe('ok');
    });

    it(`channel=${channel}: suppressed when scope=all suppression active`, () => {
      const sup: SuppressionSnapshot = { scope: 'all', startsAt: new Date(0), endsAt: null };
      const result = checkSendability(params({
        channel,
        consents: [OPTED_IN(channel)],
        suppressions: [sup],
      }));
      expect(result.sendable).toBe(false);
      expect(result.reason).toBe('suppressed');
    });
  }
});
