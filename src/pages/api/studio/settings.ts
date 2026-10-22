export const prerender = false;

import type { APIRoute } from 'astro';
import { clerkClient } from '@clerk/astro/server';

export interface StudioSettings {
  orgName: string;
  campaignName: string;
  dayNumber: string;
  voiceTone: string;
}

const DEFAULTS: StudioSettings = {
  orgName: '',
  campaignName: '',
  dayNumber: '1',
  voiceTone: 'Story-first. Human. No hype or corporate speak.',
};

export const GET: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const clerk = clerkClient(context);
  const user = await clerk.users.getUser(userId);
  const meta = (user.privateMetadata as Record<string, unknown>) ?? {};
  const settings: StudioSettings = {
    orgName:      (meta.orgName as string)      ?? DEFAULTS.orgName,
    campaignName: (meta.campaignName as string) ?? DEFAULTS.campaignName,
    dayNumber:    (meta.dayNumber as string)    ?? DEFAULTS.dayNumber,
    voiceTone:    (meta.voiceTone as string)    ?? DEFAULTS.voiceTone,
  };

  return json({ settings });
};

export const POST: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  let body: Partial<StudioSettings>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const clerk = clerkClient(context);
  const user = await clerk.users.getUser(userId);
  const existing = (user.privateMetadata as Record<string, unknown>) ?? {};

  const updated: Record<string, unknown> = { ...existing };
  if (body.orgName      !== undefined) updated.orgName      = body.orgName;
  if (body.campaignName !== undefined) updated.campaignName = body.campaignName;
  if (body.dayNumber    !== undefined) updated.dayNumber    = body.dayNumber;
  if (body.voiceTone    !== undefined) updated.voiceTone    = body.voiceTone;

  await clerk.users.updateUserMetadata(userId, { privateMetadata: updated });

  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
