export const prerender = false;

import type { APIRoute } from 'astro';
import { clerkClient } from '@clerk/astro/server';

const ZERNIO_BASE = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  displayName: string;
  isActive: boolean;
}

export const GET: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const clerk = clerkClient(context);
  const user = await clerk.users.getUser(userId);
  const profileId = (user.privateMetadata as Record<string, unknown>)?.zernioProfileId as string | undefined;

  if (!profileId) {
    return json({ accounts: [] });
  }

  const res = await fetch(`${ZERNIO_BASE}/accounts?profileId=${encodeURIComponent(profileId)}&limit=100`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) return json({ error: 'Invalid Zernio API key.' }, 401);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'error fetching accounts'}` }, 502);
  }

  const data = (await res.json()) as { data?: ZernioAccount[]; accounts?: ZernioAccount[] } | ZernioAccount[];
  const raw: ZernioAccount[] = Array.isArray(data)
    ? data
    : ((data as { data?: ZernioAccount[] }).data ?? (data as { accounts?: ZernioAccount[] }).accounts ?? []);

  const accounts = raw
    .filter((a) => a.isActive !== false)
    .map((a) => ({
      id: a._id,
      platform: a.platform,
      username: a.username || a.displayName,
    }));

  return json({ accounts });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
