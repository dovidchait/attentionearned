import { env } from '../lib/env.js';
import { renderTemplate } from './render.js';
import type { SendRequest, SendResult, RenderedPayload } from './interface.js';

interface EmailItBody {
  to: Array<{ email: string }>;
  subject: string;
  html: string;
  text: string;
}

interface EmailItResponse {
  id: string;
}

function extractSubject(body: string): string {
  // Subject line convention: first non-empty line of the template body becomes the subject;
  // the rest is the message body. Delimited by a blank line.
  const parts = body.split(/\n\n+/);
  return (parts[0] ?? '').trim();
}

function extractBodyText(body: string): string {
  const parts = body.split(/\n\n+/);
  return parts.slice(1).join('\n\n').trim();
}

function textToHtml(text: string): string {
  return text
    .split('\n')
    .map(line => (line.trim() === '' ? '<br>' : `<p>${line}</p>`))
    .join('\n');
}

function buildEmailPayload(req: SendRequest): EmailItBody {
  const rendered = renderTemplate(req.template.body, req.template.variables, req.variables);
  const subject = extractSubject(rendered);
  const bodyText = extractBodyText(rendered) || rendered; // fallback if no blank-line separator
  const html = textToHtml(bodyText);

  return {
    to: [{ email: req.to }],
    subject,
    html,
    text: bodyText,
  };
}

async function callEmailIt(payload: EmailItBody): Promise<string> {
  const apiKey = env.EMAILIT_API_KEY;
  if (!apiKey) throw new Error('EMAILIT_API_KEY is not configured');

  const res = await fetch(`${env.EMAILIT_BASE_URL}/v1/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`EmailIt ${res.status}: ${detail}`);
  }

  const data = await res.json() as EmailItResponse;
  return data.id;
}

export async function sendViaEmailIt(req: SendRequest, dryRun: boolean): Promise<SendResult> {
  if (req.channel !== 'email') {
    throw new Error(`EmailItAdapter does not handle channel: ${req.channel}`);
  }

  const body = buildEmailPayload(req);
  const endpoint = `${env.EMAILIT_BASE_URL}/v1/send`;

  const rendered: RenderedPayload = { provider: 'emailit', endpoint, body };

  if (dryRun) {
    return { dryRun: true, rendered };
  }

  const providerMessageId = await callEmailIt(body);
  return { dryRun: false, providerMessageId, rendered };
}
