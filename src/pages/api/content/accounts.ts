export const prerender = false;

import type { APIRoute } from 'astro';

interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  displayName: string;
  isActive: boolean;
  profileUrl?: string;
}

export const GET: APIRoute = async ({ url }) => {
  const apiKey = url.searchParams.get('apiKey');
  if (!apiKey?.trim()) {
    return json({ error: 'apiKey is required.' }, 400);
  }

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://api.zernio.com/v1';

  const res = await fetch(`${base}/accounts?limit=100`, {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) {
    return json({ error: 'Invalid Zernio API key.' }, 401);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'error fetching accounts'}` }, 502);
  }

  const data = (await res.json()) as { data?: ZernioAccount[]; accounts?: ZernioAccount[] } | ZernioAccount[];

  // Normalise — Zernio returns either { data: [...] } or a bare array
  const raw: ZernioAccount[] = Array.isArray(data)
    ? data
    : ((data as { data?: ZernioAccount[]; accounts?: ZernioAccount[] }).data ??
       (data as { accounts?: ZernioAccount[] }).accounts ??
       []);

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
