import { randomUUID } from 'crypto';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import type { ChannelAdapter, SendParams, SendResult } from './types.js';

/**
 * EmailIt adapter.
 *
 * NOTE: The EmailIt REST API shape below is based on plausible patterns.
 * Validate and update against real EmailIt docs / sandbox responses before production.
 * Commit a real fixture to test/fixtures/emailit-send-response.json once confirmed.
 */
export class EmailItAdapter implements ChannelAdapter {
  async send(params: SendParams): Promise<SendResult> {
    if (params.channel !== 'email') {
      throw new Error(`EmailItAdapter does not support channel: ${params.channel}`);
    }

    if (env.DRY_RUN) {
      logger.info({ touchId: params.touchId, donorId: params.donorId },
        'dry-run: EmailIt send — no network call');
      logger.debug({ touchId: params.touchId, renderedBody: params.templateBody },
        'dry-run: rendered payload');
      return { providerMessageId: `dry-run-${randomUUID()}`, dryRun: true };
    }

    if (!env.EMAILIT_API_KEY) {
      throw new Error('EMAILIT_API_KEY is not configured');
    }
    if (!params.recipientEmail) throw new Error('recipientEmail required for email send');

    const senderDomain = params.emailitSenderDomain ?? 'mail.example.com';
    const payload: Record<string, unknown> = {
      from: `noreply@${senderDomain}`,
      to: params.recipientEmail,
      subject: params.variables['subject'] ?? 'A message for you',
      html: params.templateBody,
    };

    if (params.mediaRenditionUri) {
      payload['attachments'] = [{ url: params.mediaRenditionUri }];
    }

    const url = `${env.EMAILIT_BASE_URL}/v1/emails`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.EMAILIT_API_KEY}`,
        'Idempotency-Key': params.touchId,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`EmailIt send failed (${res.status}): ${text}`);
    }

    const body = await res.json() as { id?: string };
    const messageId = body.id ?? `emailit-${randomUUID()}`;
    logger.info({ touchId: params.touchId, providerMessageId: messageId }, 'EmailIt email sent');
    return { providerMessageId: messageId, dryRun: false };
  }
}
