import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { touches, events } from '../schema/index.js';
import { logger } from '../lib/logger.js';

/**
 * Maps incoming provider webhook payloads to events rows.
 *
 * Call from your HTTP handler after verifying the request signature.
 * Both Zernio and EmailIt webhooks are handled here.
 */

type EventType = 'delivered' | 'read' | 'replied' | 'clicked' | 'failed' | 'opt_out';

interface NormalizedEvent {
  providerMessageId: string;
  type: EventType;
  occurredAt: Date;
  payload: unknown;
}

function normalizeZernioEvent(body: unknown): NormalizedEvent | null {
  const b = body as Record<string, unknown>;
  const messageId = String(b['message_id'] ?? '');
  const statusRaw = String(b['status'] ?? '').toLowerCase();

  const typeMap: Record<string, EventType> = {
    delivered: 'delivered',
    read: 'read',
    replied: 'replied',
    clicked: 'clicked',
    failed: 'failed',
    opt_out: 'opt_out',
    unsubscribed: 'opt_out',
  };

  const type = typeMap[statusRaw];
  if (!messageId || !type) return null;

  const ts = b['timestamp'] as string | undefined;
  return {
    providerMessageId: messageId,
    type,
    occurredAt: ts ? new Date(ts) : new Date(),
    payload: b,
  };
}

function normalizeEmailItEvent(body: unknown): NormalizedEvent | null {
  const b = body as Record<string, unknown>;
  const messageId = String(b['id'] ?? '');
  const eventRaw = String(b['event'] ?? '').toLowerCase();

  const typeMap: Record<string, EventType> = {
    delivered: 'delivered',
    opened: 'read',
    clicked: 'clicked',
    bounced: 'failed',
    failed: 'failed',
    unsubscribed: 'opt_out',
    spam: 'opt_out',
  };

  const type = typeMap[eventRaw];
  if (!messageId || !type) return null;

  const ts = b['created_at'] as string | undefined;
  return {
    providerMessageId: messageId,
    type,
    occurredAt: ts ? new Date(ts) : new Date(),
    payload: b,
  };
}

type Provider = 'zernio' | 'emailit';

export async function handleProviderWebhook(provider: Provider, body: unknown): Promise<void> {
  const normalized =
    provider === 'zernio'
      ? normalizeZernioEvent(body)
      : normalizeEmailItEvent(body);

  if (!normalized) {
    logger.warn({ provider }, 'Unrecognized webhook payload — skipped');
    return;
  }

  const [touch] = await db
    .select({ id: touches.id, donorId: touches.donorId })
    .from(touches)
    .where(eq(touches.providerMessageId, normalized.providerMessageId))
    .limit(1);

  if (!touch) {
    logger.warn({ provider, providerMessageId: normalized.providerMessageId }, 'No touch found for webhook — skipped');
    return;
  }

  await db.insert(events).values({
    donorId: touch.donorId,
    touchId: touch.id,
    type: normalized.type,
    payload: normalized.payload as Record<string, unknown>,
    occurredAt: normalized.occurredAt,
  });

  // Reflect terminal states back on the touch
  if (normalized.type === 'delivered' || normalized.type === 'read') {
    await db
      .update(touches)
      .set({ status: normalized.type })
      .where(eq(touches.id, touch.id));
  } else if (normalized.type === 'failed') {
    await db
      .update(touches)
      .set({ status: 'failed' })
      .where(eq(touches.id, touch.id));
  }

  logger.info({ touchId: touch.id, type: normalized.type }, 'Webhook event recorded');
}
