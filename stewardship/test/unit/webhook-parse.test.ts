import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => join(__dirname, '../fixtures', name);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const insertedEvents: unknown[] = [];
const updatedTouches: unknown[] = [];
const insertedSuppressions: unknown[] = [];

const mockTouch = {
  id: 'touch-001',
  donorId: 'donor-001',
  orgId: 'org-001',
};

vi.mock('../../src/lib/db.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([mockTouch])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
        returning: vi.fn(() => Promise.resolve([])),
        // for plain insert (no conflict clause)
        then: undefined,
        // make insert(...).values(...) awaitable
        [Symbol.toStringTag]: 'Promise',
        // Vitest needs thenable or we need .returning()
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock('../../src/lib/env.js', () => ({
  env: {
    ZERNIO_WEBHOOK_SECRET: 'test-secret',
    EMAILIT_WEBHOOK_SECRET: 'test-secret',
    DRY_RUN: true,
    LOG_LEVEL: 'error',
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function signBody(body: Buffer, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// ── Zernio webhook parsing ────────────────────────────────────────────────────

describe('handleZernioEvent — signature verification', () => {
  it('rejects a mismatched signature', async () => {
    const { handleZernioEvent, WebhookAuthError } = await import('../../src/webhooks/handlers.js');
    const body = Buffer.from(JSON.stringify({ event: 'delivered', message_id: 'x' }));
    await expect(handleZernioEvent(body, 'sha256=bad')).rejects.toThrow(WebhookAuthError);
  });

  it('accepts a correct HMAC-SHA256 signature', async () => {
    const { handleZernioEvent } = await import('../../src/webhooks/handlers.js');
    const raw = readFileSync(fixturePath('zernio-webhook-delivered.json'));
    const sig = signBody(raw, 'test-secret');
    await expect(handleZernioEvent(raw, sig)).resolves.toBeUndefined();
  });

  it('skips verification when secret is empty', async () => {
    // Re-import with empty secret
    vi.doMock('../../src/lib/env.js', () => ({
      env: { ZERNIO_WEBHOOK_SECRET: '', EMAILIT_WEBHOOK_SECRET: '', LOG_LEVEL: 'error' },
    }));
    const { handleZernioEvent } = await import('../../src/webhooks/handlers.js?empty-secret');
    const body = Buffer.from(JSON.stringify({ event: 'delivered', message_id: 'zm_test_abc123' }));
    // Should not throw regardless of signature
    await expect(handleZernioEvent(body, 'garbage')).resolves.toBeUndefined();
    vi.doUnmock('../../src/lib/env.js');
  });
});

describe('handleZernioEvent — event mapping', () => {
  it('parses a delivered event from fixture', async () => {
    const { handleZernioEvent } = await import('../../src/webhooks/handlers.js');
    const raw = readFileSync(fixturePath('zernio-webhook-delivered.json'));
    const sig = signBody(raw, 'test-secret');

    const fixture = JSON.parse(raw.toString()) as { event: string; message_id: string };
    expect(fixture.event).toBe('delivered');
    expect(fixture.message_id).toBe('zm_test_abc123');
    await expect(handleZernioEvent(raw, sig)).resolves.toBeUndefined();
  });

  it('parses an opt_out event from fixture', async () => {
    const { handleZernioEvent } = await import('../../src/webhooks/handlers.js');
    const raw = readFileSync(fixturePath('zernio-webhook-opt-out.json'));
    const sig = signBody(raw, 'test-secret');

    const fixture = JSON.parse(raw.toString()) as { event: string };
    expect(fixture.event).toBe('opt_out');
    await expect(handleZernioEvent(raw, sig)).resolves.toBeUndefined();
  });

  it('ignores invalid JSON gracefully', async () => {
    const { handleZernioEvent } = await import('../../src/webhooks/handlers.js');
    const body = Buffer.from('not json');
    const sig = signBody(body, 'test-secret');
    await expect(handleZernioEvent(body, sig)).resolves.toBeUndefined();
  });

  it('ignores unknown event types without throwing', async () => {
    const { handleZernioEvent } = await import('../../src/webhooks/handlers.js');
    const body = Buffer.from(JSON.stringify({ event: 'supersecret_future_event', message_id: 'zm_test_abc123' }));
    const sig = signBody(body, 'test-secret');
    await expect(handleZernioEvent(body, sig)).resolves.toBeUndefined();
  });
});

// ── EmailIt webhook parsing ───────────────────────────────────────────────────

describe('handleEmailItEvent — signature verification', () => {
  it('rejects a mismatched signature', async () => {
    const { handleEmailItEvent, WebhookAuthError } = await import('../../src/webhooks/handlers.js');
    const body = Buffer.from(JSON.stringify({ event: 'delivered', message_id: 'x' }));
    await expect(handleEmailItEvent(body, 'sha256=bad')).rejects.toThrow(WebhookAuthError);
  });
});

describe('handleEmailItEvent — event mapping', () => {
  it('parses a delivered event from fixture', async () => {
    const { handleEmailItEvent } = await import('../../src/webhooks/handlers.js');
    const raw = readFileSync(fixturePath('emailit-webhook-delivered.json'));
    const sig = signBody(raw, 'test-secret');

    const fixture = JSON.parse(raw.toString()) as { event: string; message_id: string };
    expect(fixture.event).toBe('delivered');
    expect(fixture.message_id).toBe('eit_msg_test_456');
    await expect(handleEmailItEvent(raw, sig)).resolves.toBeUndefined();
  });

  it('ignores unknown event types without throwing', async () => {
    const { handleEmailItEvent } = await import('../../src/webhooks/handlers.js');
    const body = Buffer.from(JSON.stringify({ event: 'future_event', message_id: 'eit_msg_test_456' }));
    const sig = signBody(body, 'test-secret');
    await expect(handleEmailItEvent(body, sig)).resolves.toBeUndefined();
  });
});
