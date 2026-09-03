import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { touches } from '../schema/index.js';
import { assertSendable } from '../consent/index.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { sendViaZernio } from './zernio.js';
import { sendViaEmailIt } from './emailit.js';
import type { SendRequest, SendResult } from './interface.js';

/**
 * Sends one touch, respecting all guardrails:
 *   §5.1  DRY_RUN and SEND_ENABLED switches
 *   §5.3  Sendability (org, consent, suppression) via assertSendable
 *   §5.2  DRY_RUN mode — render payload, touch no network
 *
 * On a successful live send, updates touch.status='sent', touch.providerMessageId, touch.sentAt.
 * On a dry-run send, logs the rendered payload at debug level.
 * On sendability failure, updates touch.status='skipped' with the reason.
 */
export async function dispatchTouch(touchId: string): Promise<SendResult | null> {
  const [touch] = await db
    .select()
    .from(touches)
    .where(eq(touches.id, touchId))
    .limit(1);

  if (!touch) throw new Error(`dispatchTouch: touch not found: ${touchId}`);
  if (touch.status !== 'queued') {
    logger.warn({ touchId }, `dispatchTouch: touch is not queued (status=${touch.status}), skipping`);
    return null;
  }

  if (!touch.templateId) throw new Error(`dispatchTouch: touch ${touchId} has no templateId`);

  const sendable = await assertSendable(touch.donorId, touch.channel as 'whatsapp' | 'sms' | 'email');
  if (!sendable.sendable) {
    await db
      .update(touches)
      .set({ status: 'skipped', skipReason: sendable.reason })
      .where(eq(touches.id, touchId));
    logger.info({ touchId, reason: sendable.reason }, 'Touch skipped — not sendable');
    return null;
  }

  // Resolve donor contact info
  const { donors } = await import('../schema/index.js');
  const [donor] = await db
    .select({ phoneE164: donors.phoneE164, email: donors.email })
    .from(donors)
    .where(eq(donors.id, touch.donorId))
    .limit(1);

  if (!donor) throw new Error(`dispatchTouch: donor not found: ${touch.donorId}`);

  const to = touch.channel === 'email'
    ? (donor.email ?? '')
    : (donor.phoneE164 ?? '');

  if (!to) {
    await db
      .update(touches)
      .set({ status: 'skipped', skipReason: 'no_contact_for_channel' })
      .where(eq(touches.id, touchId));
    return null;
  }

  // Resolve template
  const { templates } = await import('../schema/index.js');
  const [tmpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, touch.templateId))
    .limit(1);

  if (!tmpl) throw new Error(`dispatchTouch: template not found: ${touch.templateId}`);

  // Resolve media rendition URI if touch has an assetId
  let media: { uri: string; mimeType: string } | undefined;
  if (touch.assetId && touch.channel !== 'sms') {
    const { mediaRenditions } = await import('../schema/index.js');
    const [rendition] = await db
      .select({ uri: mediaRenditions.uri })
      .from(mediaRenditions)
      .where(
        and(
          eq(mediaRenditions.assetId, touch.assetId),
          eq(mediaRenditions.channel, touch.channel),
        ),
      )
      .limit(1);

    if (rendition) {
      const { mediaAssets } = await import('../schema/index.js');
      const [asset] = await db
        .select({ kind: mediaAssets.kind })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, touch.assetId))
        .limit(1);

      const mimeType = asset?.kind === 'video' ? 'video/mp4' : 'image/jpeg';
      media = { uri: rendition.uri, mimeType };
    }
  }

  const req: SendRequest = {
    touchId,
    donorId: touch.donorId,
    channel: touch.channel as 'whatsapp' | 'sms' | 'email',
    to,
    template: tmpl as import('./interface.js').TemplateRecord,
    variables: (touch.variables ?? {}) as Record<string, string>,
    media,
  };

  const dryRun = env.DRY_RUN;

  let result: SendResult;
  if (touch.channel === 'email') {
    result = await sendViaEmailIt(req, dryRun);
  } else {
    result = await sendViaZernio(req, dryRun);
  }

  if (result.dryRun) {
    logger.debug({ touchId, channel: touch.channel, payload: result.rendered }, 'DRY RUN — payload not sent');
  } else {
    await db
      .update(touches)
      .set({
        status: 'sent',
        providerMessageId: result.providerMessageId,
        provider: result.rendered.provider,
        sentAt: new Date(),
      })
      .where(eq(touches.id, touchId));
    logger.info({ touchId, channel: touch.channel }, 'Touch sent');
  }

  return result;
}
