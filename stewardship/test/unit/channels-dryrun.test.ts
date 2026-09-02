import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZernioAdapter } from '../../src/channels/zernio.js';
import { EmailItAdapter } from '../../src/channels/emailit.js';
import type { SendParams } from '../../src/channels/types.js';

// Force DRY_RUN=true for all tests in this file (default in env.ts already, but guard explicitly)
vi.mock('../../src/lib/env.js', () => ({
  env: {
    DRY_RUN: true,
    SEND_ENABLED: false,
    ZERNIO_API_KEY: '',
    ZERNIO_BASE_URL: 'https://api.zernio.io',
    EMAILIT_API_KEY: '',
    EMAILIT_BASE_URL: 'https://api.emailit.com',
    ZERNIO_WEBHOOK_SECRET: '',
    EMAILIT_WEBHOOK_SECRET: '',
    WEBHOOK_PORT: '3001',
    LOG_LEVEL: 'error',
    MEDIA_DIR: './media',
  },
}));

// Suppress logger output in tests
vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function whatsappParams(overrides: Partial<SendParams> = {}): SendParams {
  return {
    touchId: 'touch-001',
    donorId: 'donor-001',
    orgId: 'org-001',
    channel: 'whatsapp',
    templateBody: 'Hello Dovid, thank you for your gift.',
    variables: { first_name: 'Dovid', amount: '$36' },
    metaTemplateName: 'thank_you_v2',
    recipientPhone: '+12125551234',
    zernioProfileId: 'profile-abc',
    ...overrides,
  };
}

function smsParams(overrides: Partial<SendParams> = {}): SendParams {
  return {
    touchId: 'touch-002',
    donorId: 'donor-002',
    orgId: 'org-001',
    channel: 'sms',
    templateBody: 'Thank you for your donation!',
    variables: {},
    recipientPhone: '+12125559999',
    ...overrides,
  };
}

function emailParams(overrides: Partial<SendParams> = {}): SendParams {
  return {
    touchId: 'touch-003',
    donorId: 'donor-003',
    orgId: 'org-001',
    channel: 'email',
    templateBody: '<p>Thank you, Rivka.</p>',
    variables: { first_name: 'Rivka', subject: 'Thank you' },
    recipientEmail: 'donor@example.com',
    emailitSenderDomain: 'mail.example.org',
    ...overrides,
  };
}

describe('ZernioAdapter — dry-run WhatsApp', () => {
  const adapter = new ZernioAdapter();

  it('returns dryRun=true', async () => {
    const result = await adapter.send(whatsappParams());
    expect(result.dryRun).toBe(true);
  });

  it('returns a provider_message_id starting with dry-run-', async () => {
    const result = await adapter.send(whatsappParams());
    expect(result.providerMessageId).toMatch(/^dry-run-/);
  });

  it('makes no network call (global fetch not called)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await adapter.send(whatsappParams());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('generates a unique ID per call', async () => {
    const r1 = await adapter.send(whatsappParams({ touchId: 't1' }));
    const r2 = await adapter.send(whatsappParams({ touchId: 't2' }));
    expect(r1.providerMessageId).not.toBe(r2.providerMessageId);
  });
});

describe('ZernioAdapter — dry-run SMS', () => {
  const adapter = new ZernioAdapter();

  it('returns dryRun=true for SMS', async () => {
    const result = await adapter.send(smsParams());
    expect(result.dryRun).toBe(true);
  });

  it('returns a dry-run provider_message_id for SMS', async () => {
    const result = await adapter.send(smsParams());
    expect(result.providerMessageId).toMatch(/^dry-run-/);
  });
});

describe('EmailItAdapter — dry-run email', () => {
  const adapter = new EmailItAdapter();

  it('returns dryRun=true', async () => {
    const result = await adapter.send(emailParams());
    expect(result.dryRun).toBe(true);
  });

  it('returns a dry-run provider_message_id', async () => {
    const result = await adapter.send(emailParams());
    expect(result.providerMessageId).toMatch(/^dry-run-/);
  });

  it('makes no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await adapter.send(emailParams());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('throws if channel is not email', async () => {
    await expect(
      adapter.send(emailParams({ channel: 'whatsapp' })),
    ).rejects.toThrow('EmailItAdapter does not support channel: whatsapp');
  });
});

describe('ZernioAdapter — channel routing', () => {
  const adapter = new ZernioAdapter();

  it('throws for unsupported channel', async () => {
    await expect(
      adapter.send({ ...whatsappParams(), channel: 'email' }),
    ).rejects.toThrow('ZernioAdapter does not support channel: email');
  });
});
