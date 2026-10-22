export const prerender = false;

import type { APIRoute } from 'astro';
import { clerkClient } from '@clerk/astro/server';

const ZERNIO_BASE = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

export const GET: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const clerk = clerkClient(context);
  const user = await clerk.users.getUser(userId);
  const profileId = (user.privateMetadata as Record<string, unknown>)?.zernioProfileId as string | undefined;

  if (!profileId) {
    return json({ posts: [] });
  }

  const from  = context.url.searchParams.get('from')  ?? '';
  const to    = context.url.searchParams.get('to')    ?? '';
  const limit = context.url.searchParams.get('limit') ?? '100';

  const params = new URLSearchParams({ profileId, limit });
  if (from) params.set('from', from);
  if (to)   params.set('to', to);

  const res = await fetch(`${ZERNIO_BASE}/posts?${params}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) return json({ error: 'Invalid Zernio API key.' }, 401);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'error fetching posts'}` }, 502);
  }

  const data = (await res.json()) as { data?: unknown[]; posts?: unknown[] } | unknown[];
  const posts = Array.isArray(data)
    ? data
    : ((data as { data?: unknown[] }).data ?? (data as { posts?: unknown[] }).posts ?? []);

  return json({ posts });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
