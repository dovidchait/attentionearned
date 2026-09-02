import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { touches, templates, donors, orgs, mediaRenditions } from '../schema/index.js';
import { assertSendable } from '../consent/index.js';
import { renderTemplate } from './renderer.js';
import { ZernioAdapter } from './zernio.js';
import { EmailItAdapter } from './emailit.js';
import type { ChannelName } from './types.js';

export { renderTemplate } from './renderer.js';
export { RenderError } from './renderer.js';
export { ZernioAdapter } from './zernio.js';
export { EmailItAdapter } from './emailit.js';
export type { ChannelName, SendParams, SendResult, ChannelAdapter } from './types.js';

const zernio = new ZernioAdapter();
const emailit = new EmailItAdapter();

/**
 * Send a planned touch by touchId. Called by the journey worker (Phase 5) and by the CLI.
 *
 * Enforces §5.1–5.4 guardrails via assertSendable():
 *   - global SEND_ENABLED, org.send_enabled, org.status='live'
 *   - donor consent for the channel
 *   - no active suppression
 *
 * DRY_RUN is handled inside the channel adapters (§5.2):
 *   - All logging / payload rendering still happens
 *   - No outbound network call is made
 *   - touch is still updated to status='sent' with provider_message_id='dry-run-*'
 */
export async function sendTouch(touchId: string): Promise<void> {
  const now = new Date();

  // 1. Fetch touch
  const [touch] = await db
    .select()
    .from(touches)
    .where(eq(touches.id, touchId));

  if (!touch) throw new Error(`sendTouch: touch not found: ${touchId}`);

  if (touch.status !== 'planned' && touch.status !== 'queued') {
    logger.warn({ touchId, status: touch.status }, 'sendTouch: touch already processed, skipping');
    return;
  }

  const channel = touch.channel as ChannelName;

  try {
    // 2. assertSendable — single choke point for §5.1–5.4
    const sendability = await assertSendable(touch.donorId, channel);
    if (!sendability.sendable) {
      await db.update(touches)
        .set({ status: 'skipped', skipReason: sendability.reason })
        .where(eq(touches.id, touchId));
      logger.info({ touchId, donorId: touch.donorId, reason: sendability.reason }, 'touch skipped');
      return;
    }

    // 3. Fetch template
    if (!touch.templateId) throw new Error(`sendTouch: touch ${touchId} has no templateId`);
    const [tmpl] = await db
      .select()
      .from(templates)
      .where(eq(templates.id, touch.templateId));
    if (!tmpl) throw new Error(`sendTouch: template not found: ${touch.templateId}`);

    // 4. Fetch donor (for recipient address — log IDs only, never names)
    const [donor] = await db
      .select({ phone: donors.phoneE164, email: donors.email })
      .from(donors)
      .where(eq(donors.id, touch.donorId));
    if (!donor) throw new Error(`sendTouch: donor not found: ${touch.donorId}`);

    // 5. Fetch org (for provider routing)
    const [org] = await db
      .select({
        zernioProfileId: orgs.zernioProfileId,
        zernioPhoneNumberId: orgs.zernioPhoneNumberId,
        emailitSenderDomain: orgs.emailitSenderDomain,
      })
      .from(orgs)
      .where(eq(orgs.id, touch.orgId));
    if (!org) throw new Error(`sendTouch: org not found: ${touch.orgId}`);

    // 6. Fetch media rendition URI if an asset is attached
    let mediaRenditionUri: string | undefined;
    if (touch.assetId) {
      const [rendition] = await db
        .select({ uri: mediaRenditions.uri })
        .from(mediaRenditions)
        .where(eq(mediaRenditions.assetId, touch.assetId));
      mediaRenditionUri = rendition?.uri;
    }

    // 7. Render template body
    const variables = (touch.variables as Record<string, string>) ?? {};
    const renderedBody = renderTemplate(tmpl.body, variables);

    // 8. Dispatch to channel adapter
    const adapter = channel === 'email' ? emailit : zernio;
    const result = await adapter.send({
      touchId,
      donorId: touch.donorId,
      orgId: touch.orgId,
      channel,
      templateBody: renderedBody,
      variables,
      metaTemplateName: tmpl.metaTemplateName ?? undefined,
      mediaRenditionUri,
      recipientPhone: donor.phone ?? undefined,
      recipientEmail: donor.email ?? undefined,
      zernioProfileId: org.zernioProfileId ?? undefined,
      zernioPhoneNumberId: org.zernioPhoneNumberId ?? undefined,
      emailitSenderDomain: org.emailitSenderDomain ?? undefined,
    });

    // 9. Update touch record
    const provider = channel === 'email' ? 'emailit' : 'zernio';
    await db.update(touches)
      .set({
        status: 'sent',
        provider,
        providerMessageId: result.providerMessageId,
        sentAt: now,
      })
      .where(eq(touches.id, touchId));

    logger.info({ touchId, donorId: touch.donorId, channel, dryRun: result.dryRun }, 'touch sent');

  } catch (err) {
    logger.error({ touchId, err }, 'sendTouch failed');
    await db.update(touches)
      .set({ status: 'failed' })
      .where(eq(touches.id, touchId))
      .catch(() => {});
    throw err;
  }
}
