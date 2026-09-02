import { randomUUID } from 'crypto';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import type { ChannelAdapter, SendParams, SendResult } from './types.js';

/**
 * Zernio adapter — WhatsApp and SMS.
 *
 * NOTE: The Zernio REST API shape below is based on plausible patterns.
 * Validate and update against real Zernio docs / sandbox responses before production.
 * Commit a real fixture to test/fixtures/zernio-whatsapp-send-response.json once confirmed.
 */
export class ZernioAdapter implements ChannelAdapter {
  async send(params: SendParams): Promise<SendResult> {
    if (params.channel !== 'whatsapp' && params.channel !== 'sms') {
      throw new Error(`ZernioAdapter does not support channel: ${params.channel}`);
    }

    if (env.DRY_RUN) {
      logger.info({ touchId: params.touchId, channel: params.channel, donorId: params.donorId },
        'dry-run: Zernio send — no network call');
      logger.debug({ touchId: params.touchId, renderedBody: params.templateBody },
        'dry-run: rendered payload');
      return { providerMessageId: `dry-run-${randomUUID()}`, dryRun: true };
    }

    if (!env.ZERNIO_API_KEY) {
      throw new Error('ZERNIO_API_KEY is not configured');
    }

    if (params.channel === 'whatsapp') {
      return this.sendWhatsApp(params);
    }
    return this.sendSms(params);
  }

  private async sendWhatsApp(params: SendParams): Promise<SendResult> {
    if (!params.recipientPhone) throw new Error('recipientPhone required for WhatsApp send');
    if (!params.metaTemplateName) throw new Error('metaTemplateName required for WhatsApp send');

    // Build template components from variables (positional parameters for Meta template API)
    const bodyParams = Object.values(params.variables).map(v => ({ type: 'text', text: v }));
    const components: object[] = [{ type: 'body', parameters: bodyParams }];

    if (params.mediaRenditionUri) {
      components.unshift({
        type: 'header',
        parameters: [{ type: 'image', image: { link: params.mediaRenditionUri } }],
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: params.recipientPhone,
      type: 'template',
      template: {
        name: params.metaTemplateName,
        language: { code: 'en' },
        components,
      },
    };

    const url = `${env.ZERNIO_BASE_URL}/v1/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.ZERNIO_API_KEY}`,
        'Idempotency-Key': params.touchId,
        ...(params.zernioProfileId ? { 'X-Zernio-Profile': params.zernioProfileId } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zernio WhatsApp send failed (${res.status}): ${text}`);
    }

    const body = await res.json() as { message_id?: string };
    const messageId = body.message_id ?? `zernio-${randomUUID()}`;
    logger.info({ touchId: params.touchId, providerMessageId: messageId }, 'Zernio WhatsApp sent');
    return { providerMessageId: messageId, dryRun: false };
  }

  private async sendSms(params: SendParams): Promise<SendResult> {
    if (!params.recipientPhone) throw new Error('recipientPhone required for SMS send');

    const payload = {
      to: params.recipientPhone,
      body: params.templateBody,
      ...(params.zernioPhoneNumberId ? { from_number_id: params.zernioPhoneNumberId } : {}),
    };

    const url = `${env.ZERNIO_BASE_URL}/v1/sms`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.ZERNIO_API_KEY}`,
        'Idempotency-Key': params.touchId,
        ...(params.zernioProfileId ? { 'X-Zernio-Profile': params.zernioProfileId } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zernio SMS send failed (${res.status}): ${text}`);
    }

    const body = await res.json() as { message_id?: string };
    const messageId = body.message_id ?? `zernio-sms-${randomUUID()}`;
    logger.info({ touchId: params.touchId, providerMessageId: messageId }, 'Zernio SMS sent');
    return { providerMessageId: messageId, dryRun: false };
  }
}
