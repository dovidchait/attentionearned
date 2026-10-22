export const prerender = false;

import type { APIRoute } from 'astro';
import { clerkClient } from '@clerk/astro/server';

const ZERNIO_BASE = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

const SUPPORTED_PLATFORMS = [
  'instagram', 'linkedin', 'tiktok', 'facebook', 'youtube', 'twitter',
];

export const GET: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const platform = context.url.searchParams.get('platform')?.toLowerCase();
  if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
    return json({ error: 'Invalid platform.' }, 400);
  }

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const clerk = clerkClient(context);
  const user = await clerk.users.getUser(userId);
  const profileId = (user.privateMetadata as Record<string, unknown>)?.zernioProfileId as string | undefined;

  if (!profileId) {
    return json({ error: 'Zernio profile not provisioned. Call /api/studio/provision first.' }, 400);
  }

  const origin = new URL(context.request.url).origin;
  const redirectUrl = `${origin}/studio/oauth/callback?platform=${platform}`;

  // The Zernio connect URL is a direct redirect to Zernio's OAuth screen
  const connectUrl = `${ZERNIO_BASE}/connect/${platform}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;

  return json({ connectUrl });
};

// POST: handle select step after OAuth (for platforms that need page/profile selection)
export const POST: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  let body: { platform: string; connectToken: string; step: string; selectionId?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const { platform, connectToken, step, selectionId } = body;
  if (!platform || !connectToken || !step) {
    return json({ error: 'platform, connectToken, and step are required.' }, 400);
  }

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const clerk = clerkClient(context);
  const user = await clerk.users.getUser(userId);
  const profileId = (user.privateMetadata as Record<string, unknown>)?.zernioProfileId as string | undefined;

  if (!profileId) {
    return json({ error: 'Zernio profile not provisioned.' }, 400);
  }

  const res = await fetch(`${ZERNIO_BASE}/connect/${platform}/${step}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ connectToken, profileId, ...(selectionId ? { selectionId } : {}) }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'connect step failed'}` }, 502);
  }

  const data = await res.json();
  return json({ ok: true, data });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
