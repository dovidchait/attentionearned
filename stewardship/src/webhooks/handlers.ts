import { createHmac, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { touches, events, suppressions, donors } from '../schema/index.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';

export class WebhookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookAuthError';
  }
}

function verifyHmac(rawBody: Buffer, signature: string, secret: string): void {
  if (!secret) {
    logger.warn('Webhook secret not configured — skipping signature verification (dev mode)');
    return;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const sig = signature.replace(/^sha256=/, '');
  let match: boolean;
  try {
    match = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    match = false;
  }
  if (!match) throw new WebhookAuthError('Webhook signature mismatch');
}

// ── Zernio ────────────────────────────────────────────────────────────────────

interface ZernioWebhookBody {
  event?: string;
  message_id?: string;
  to?: string;
  timestamp?: string;
}

/**
 * Handle an inbound Zernio webhook event.
 * Maps provider events → events rows and updates touches.status.
 *
 * NOTE: The payload shape is based on plausible patterns.
 * Validate against real Zernio sandbox webhooks before production.
 */
export async function handleZernioEvent(rawBody: Buffer, signature: string): Promise<void> {
  verifyHmac(rawBody, signature, env.ZERNIO_WEBHOOK_SECRET);

  let body: ZernioWebhookBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as ZernioWebhookBody;
  } catch {
    logger.warn('Zernio webhook: invalid JSON body, ignoring');
    return;
  }

  const { event: eventType, message_id: providerMessageId } = body;

  if (!eventType || !providerMessageId) {
    logger.warn({ body }, 'Zernio webhook: missing event or message_id, ignoring');
    return;
  }

  // Resolve touch by provider_message_id
  const [touch] = await db
    .select({ id: touches.id, donorId: touches.donorId, orgId: touches.orgId })
    .from(touches)
    .where(eq(touches.providerMessageId, providerMessageId));

  if (!touch) {
    logger.warn({ providerMessageId }, 'Zernio webhook: no touch found for message_id, ignoring');
    return;
  }

  const occurredAt = body.timestamp ? new Date(body.timestamp) : new Date();

  if (eventType === 'delivered') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'delivered',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.update(touches).set({ status: 'delivered' }).where(eq(touches.id, touch.id));
    logger.info({ touchId: touch.id }, 'Zernio: delivered');
    return;
  }

  if (eventType === 'read') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'read',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.update(touches).set({ status: 'read' }).where(eq(touches.id, touch.id));
    logger.info({ touchId: touch.id }, 'Zernio: read');
    return;
  }

  if (eventType === 'failed') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'failed',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.update(touches).set({ status: 'failed' }).where(eq(touches.id, touch.id));
    logger.info({ touchId: touch.id }, 'Zernio: failed');
    return;
  }

  if (eventType === 'opt_out' || eventType === 'stop') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'opt_out',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    // Propagate opt-out immediately and irreversibly (§5.4)
    await db.insert(suppressions).values({
      orgId: touch.orgId,
      donorId: touch.donorId,
      reason: 'provider_opt_out',
      scope: 'all',
      startsAt: occurredAt,
      endsAt: null,
    }).onConflictDoNothing();
    logger.info({ touchId: touch.id, donorId: touch.donorId }, 'Zernio: opt_out — suppression added');
    return;
  }

  logger.info({ touchId: touch.id, eventType }, 'Zernio webhook: unknown event type, ignoring');
}

// ── EmailIt ───────────────────────────────────────────────────────────────────

interface EmailItWebhookBody {
  event?: string;
  message_id?: string;
  email?: string;
  timestamp?: string;
}

/**
 * Handle an inbound EmailIt webhook event.
 *
 * NOTE: The payload shape is based on plausible patterns.
 * Validate against real EmailIt webhooks before production.
 */
export async function handleEmailItEvent(rawBody: Buffer, signature: string): Promise<void> {
  verifyHmac(rawBody, signature, env.EMAILIT_WEBHOOK_SECRET);

  let body: EmailItWebhookBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as EmailItWebhookBody;
  } catch {
    logger.warn('EmailIt webhook: invalid JSON body, ignoring');
    return;
  }

  const { event: eventType, message_id: providerMessageId } = body;

  if (!eventType || !providerMessageId) {
    logger.warn({ body }, 'EmailIt webhook: missing event or message_id, ignoring');
    return;
  }

  const [touch] = await db
    .select({ id: touches.id, donorId: touches.donorId, orgId: touches.orgId })
    .from(touches)
    .where(eq(touches.providerMessageId, providerMessageId));

  if (!touch) {
    logger.warn({ providerMessageId }, 'EmailIt webhook: no touch found, ignoring');
    return;
  }

  const occurredAt = body.timestamp ? new Date(body.timestamp) : new Date();

  if (eventType === 'delivered') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'delivered',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.update(touches).set({ status: 'delivered' }).where(eq(touches.id, touch.id));
    logger.info({ touchId: touch.id }, 'EmailIt: delivered');
    return;
  }

  if (eventType === 'read' || eventType === 'opened') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'read',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.update(touches).set({ status: 'read' }).where(eq(touches.id, touch.id));
    logger.info({ touchId: touch.id }, 'EmailIt: read');
    return;
  }

  if (eventType === 'failed' || eventType === 'bounced') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'failed',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.update(touches).set({ status: 'failed' }).where(eq(touches.id, touch.id));
    logger.info({ touchId: touch.id }, 'EmailIt: failed/bounced');
    return;
  }

  if (eventType === 'unsubscribed' || eventType === 'opt_out') {
    await db.insert(events).values({
      donorId: touch.donorId,
      touchId: touch.id,
      type: 'opt_out',
      payload: body as Record<string, unknown>,
      occurredAt,
    });
    await db.insert(suppressions).values({
      orgId: touch.orgId,
      donorId: touch.donorId,
      reason: 'provider_opt_out',
      scope: 'all',
      startsAt: occurredAt,
      endsAt: null,
    }).onConflictDoNothing();
    logger.info({ touchId: touch.id, donorId: touch.donorId }, 'EmailIt: opt_out — suppression added');
    return;
  }

  logger.info({ touchId: touch.id, eventType }, 'EmailIt webhook: unknown event type, ignoring');
}
