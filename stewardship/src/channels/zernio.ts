import { env } from '../lib/env.js';
import { renderTemplate } from './render.js';
import type { SendRequest, SendResult, RenderedPayload } from './interface.js';

/**
 * Zernio adapter — WhatsApp template sends and SMS.
 *
 * WhatsApp sends use Meta template messages (pre-approved on Meta's side).
 * The metaTemplateName on the template record must match the name Meta knows.
 *
 * SMS sends render the template body inline (no Meta approval needed).
 */

interface ZernioWhatsAppBody {
  to: string;
  template: {
    name: string;
    language: { code: string };
    components: ZernioComponent[];
  };
}

interface ZernioSmsBody {
  to: string;
  body: string;
}

interface ZernioComponent {
  type: 'header' | 'body';
  parameters: ZernioParameter[];
}

interface ZernioParameter {
  type: 'text' | 'image' | 'video';
  text?: string;
  image?: { link: string };
  video?: { link: string };
}

interface ZernioSendResponse {
  message_id: string;
}

function buildWhatsAppPayload(req: SendRequest): ZernioWhatsAppBody {
  if (!req.template.metaTemplateName) {
    throw new Error(`WhatsApp template ${req.template.key} has no metaTemplateName — cannot send without Meta approval`);
  }

  const components: ZernioComponent[] = [];

  if (req.template.hasMediaHeader && req.media) {
    const isVideo = req.media.mimeType.startsWith('video/');
    const param: ZernioParameter = isVideo
      ? { type: 'video', video: { link: req.media.uri } }
      : { type: 'image', image: { link: req.media.uri } };
    components.push({ type: 'header', parameters: [param] });
  }

  const bodyParams: ZernioParameter[] = req.template.variables.map(name => ({
    type: 'text',
    text: req.variables[name] ?? '',
  }));

  if (bodyParams.length > 0) {
    components.push({ type: 'body', parameters: bodyParams });
  }

  return {
    to: req.to,
    template: {
      name: req.template.metaTemplateName,
      language: { code: 'en' },
      components,
    },
  };
}

function buildSmsPayload(req: SendRequest): ZernioSmsBody {
  const body = renderTemplate(req.template.body, req.template.variables, req.variables);
  return { to: req.to, body };
}

async function callZernio(
  endpoint: string,
  payload: ZernioWhatsAppBody | ZernioSmsBody,
): Promise<string> {
  const apiKey = env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error('ZERNIO_API_KEY is not configured');

  const res = await fetch(`${env.ZERNIO_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Zernio ${res.status}: ${detail}`);
  }

  const data = await res.json() as ZernioSendResponse;
  return data.message_id;
}

export async function sendViaZernio(req: SendRequest, dryRun: boolean): Promise<SendResult> {
  const channel = req.channel;
  if (channel !== 'whatsapp' && channel !== 'sms') {
    throw new Error(`ZernioAdapter does not handle channel: ${channel}`);
  }

  let body: ZernioWhatsAppBody | ZernioSmsBody;
  let endpoint: string;

  if (channel === 'whatsapp') {
    body = buildWhatsAppPayload(req);
    endpoint = '/v1/messages/template';
  } else {
    body = buildSmsPayload(req);
    endpoint = '/v1/messages/sms';
  }

  const rendered: RenderedPayload = {
    provider: 'zernio',
    endpoint: `${env.ZERNIO_BASE_URL}${endpoint}`,
    body,
  };

  if (dryRun) {
    return { dryRun: true, rendered };
  }

  const providerMessageId = await callZernio(endpoint, body);
  return { dryRun: false, providerMessageId, rendered };
}
