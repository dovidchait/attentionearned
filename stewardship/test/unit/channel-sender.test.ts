/**
 * Phase 4 acceptance: with DRY_RUN=true, a full send renders correct payloads
 * for all three channels and touches no network.
 *
 * These tests call the adapters directly (no DB, no network).
 */
import { describe, it, expect } from 'vitest';
import { sendViaZernio } from '../../src/channels/zernio.js';
import { sendViaEmailIt } from '../../src/channels/emailit.js';
import type { SendRequest } from '../../src/channels/interface.js';

const WHATSAPP_TEMPLATE = {
  id: 'tmpl-1',
  orgId: 'org-1',
  channel: 'whatsapp' as const,
  key: 'thank_you_v1',
  version: '1',
  body: 'Thank you {{first_name}} for your gift!',
  variables: ['first_name'],
  hasMediaHeader: false,
  metaTemplateName: 'thank_you_v1',
  metaStatus: 'approved',
};

const WHATSAPP_MEDIA_TEMPLATE = {
  ...WHATSAPP_TEMPLATE,
  key: 'thank_you_photo_v1',
  hasMediaHeader: true,
  metaTemplateName: 'thank_you_photo_v1',
};

const SMS_TEMPLATE = {
  id: 'tmpl-2',
  orgId: 'org-1',
  channel: 'sms' as const,
  key: 'sms_thank_you_v1',
  version: '1',
  body: 'Thank you {{first_name}} for your gift to {{org_name}}!',
  variables: ['first_name', 'org_name'],
  hasMediaHeader: false,
  metaTemplateName: null,
  metaStatus: null,
};

const EMAIL_TEMPLATE = {
  id: 'tmpl-3',
  orgId: 'org-1',
  channel: 'email' as const,
  key: 'email_thank_you_v1',
  version: '1',
  body: 'Thank you for your generous gift, {{first_name}}!\n\nYour support makes a real difference at {{org_name}}.\n\nWith gratitude,\nThe Team',
  variables: ['first_name', 'org_name'],
  hasMediaHeader: false,
  metaTemplateName: null,
  metaStatus: null,
};

function makeReq(overrides: Partial<SendRequest> & { template: SendRequest['template'] }): SendRequest {
  return {
    touchId: 'touch-1',
    donorId: 'donor-1',
    channel: overrides.template.channel,
    to: overrides.to ?? '+12125550100',
    variables: { first_name: 'Chana', org_name: 'Chabad' },
    ...overrides,
  };
}

describe('Zernio adapter — dry run (no network)', () => {
  it('renders a WhatsApp template payload with body variables', async () => {
    const req = makeReq({ template: WHATSAPP_TEMPLATE });
    const result = await sendViaZernio(req, true);

    expect(result.dryRun).toBe(true);
    expect(result.rendered.provider).toBe('zernio');

    const body = result.rendered.body as Record<string, unknown>;
    expect(body['to']).toBe('+12125550100');

    const tmpl = body['template'] as Record<string, unknown>;
    expect(tmpl['name']).toBe('thank_you_v1');

    const components = tmpl['components'] as Array<Record<string, unknown>>;
    const bodyComp = components.find(c => c['type'] === 'body');
    expect(bodyComp).toBeDefined();

    const params = bodyComp!['parameters'] as Array<Record<string, unknown>>;
    expect(params[0]['text']).toBe('Chana');
  });

  it('includes media header component when template has hasMediaHeader and media is provided', async () => {
    const req = makeReq({
      template: WHATSAPP_MEDIA_TEMPLATE,
      media: { uri: 'https://cdn.example.com/photo.jpg', mimeType: 'image/jpeg' },
    });
    const result = await sendViaZernio(req, true);

    const body = result.rendered.body as Record<string, unknown>;
    const components = (body['template'] as Record<string, unknown>)['components'] as Array<Record<string, unknown>>;
    const headerComp = components.find(c => c['type'] === 'header');
    expect(headerComp).toBeDefined();
    const headerParams = headerComp!['parameters'] as Array<Record<string, unknown>>;
    expect(headerParams[0]['type']).toBe('image');
    expect((headerParams[0]['image'] as Record<string, unknown>)['link']).toBe('https://cdn.example.com/photo.jpg');
  });

  it('renders a video header when mimeType starts with video/', async () => {
    const req = makeReq({
      template: WHATSAPP_MEDIA_TEMPLATE,
      media: { uri: 'https://cdn.example.com/clip.mp4', mimeType: 'video/mp4' },
    });
    const result = await sendViaZernio(req, true);
    const body = result.rendered.body as Record<string, unknown>;
    const components = (body['template'] as Record<string, unknown>)['components'] as Array<Record<string, unknown>>;
    const headerComp = components.find(c => c['type'] === 'header')!;
    const params = headerComp['parameters'] as Array<Record<string, unknown>>;
    expect(params[0]['type']).toBe('video');
  });

  it('renders an SMS payload with the fully resolved body', async () => {
    const req = makeReq({ template: SMS_TEMPLATE });
    const result = await sendViaZernio(req, true);

    expect(result.dryRun).toBe(true);
    const body = result.rendered.body as Record<string, unknown>;
    expect(body['to']).toBe('+12125550100');
    expect(body['body']).toBe('Thank you Chana for your gift to Chabad!');
  });

  it('throws when a WhatsApp template has no metaTemplateName', async () => {
    const req = makeReq({
      template: { ...WHATSAPP_TEMPLATE, metaTemplateName: null },
    });
    await expect(sendViaZernio(req, true)).rejects.toThrow('no metaTemplateName');
  });

  it('throws when an unsupported channel is passed', async () => {
    const req = makeReq({ template: EMAIL_TEMPLATE, channel: 'email' } as SendRequest);
    await expect(sendViaZernio(req as unknown as SendRequest, true)).rejects.toThrow();
  });
});

describe('EmailIt adapter — dry run (no network)', () => {
  it('renders an email payload with subject and body', async () => {
    const req = makeReq({ template: EMAIL_TEMPLATE, to: 'chana@example.com' });
    const result = await sendViaEmailIt(req, true);

    expect(result.dryRun).toBe(true);
    expect(result.rendered.provider).toBe('emailit');

    const body = result.rendered.body as Record<string, unknown>;
    const toList = body['to'] as Array<Record<string, string>>;
    expect(toList[0]['email']).toBe('chana@example.com');

    expect(body['subject']).toBe('Thank you for your generous gift, Chana!');
    expect(body['text']).toContain('Your support makes a real difference at Chabad.');
  });

  it('produces html wrapping plain text', async () => {
    const req = makeReq({ template: EMAIL_TEMPLATE, to: 'chana@example.com' });
    const result = await sendViaEmailIt(req, true);
    const body = result.rendered.body as Record<string, unknown>;
    expect(typeof body['html']).toBe('string');
    expect((body['html'] as string).length).toBeGreaterThan(0);
  });

  it('throws when channel is not email', async () => {
    const req = makeReq({ template: SMS_TEMPLATE, channel: 'sms' } as SendRequest);
    await expect(sendViaEmailIt(req as unknown as SendRequest, true)).rejects.toThrow();
  });
});

describe('Dry-run contract — no network calls made', () => {
  it('does not call fetch for WhatsApp dry-run', async () => {
    // If fetch were called it would throw (no ZERNIO_API_KEY in test env), which would fail the test.
    // We verify by confirming the result comes back without error.
    const req = makeReq({ template: WHATSAPP_TEMPLATE });
    const result = await sendViaZernio(req, true);
    expect(result.dryRun).toBe(true);
  });

  it('does not call fetch for SMS dry-run', async () => {
    const req = makeReq({ template: SMS_TEMPLATE });
    const result = await sendViaZernio(req, true);
    expect(result.dryRun).toBe(true);
  });

  it('does not call fetch for email dry-run', async () => {
    const req = makeReq({ template: EMAIL_TEMPLATE, to: 'test@example.com' });
    const result = await sendViaEmailIt(req, true);
    expect(result.dryRun).toBe(true);
  });
});
