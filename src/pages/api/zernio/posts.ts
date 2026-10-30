export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const profileId = url.searchParams.get('profileId');
  const status = url.searchParams.get('status') ?? 'all';
  const limit = url.searchParams.get('limit') ?? '50';

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

  const params = new URLSearchParams({ limit });
  if (profileId) params.set('profileId', profileId);
  if (status !== 'all') params.set('status', status);

  const res = await fetch(`${base}/posts?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) return json({ error: 'Invalid Zernio API key.' }, 401);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'error fetching posts'}` }, 502);
  }

  const data = (await res.json()) as
    | { data?: unknown[]; posts?: unknown[] }
    | unknown[];

  const raw = Array.isArray(data)
    ? data
    : ((data as { data?: unknown[] }).data ??
      (data as { posts?: unknown[] }).posts ??
      []);

  return json({ posts: raw });
};

// DELETE: remove/cancel a scheduled post
export const DELETE: APIRoute = async ({ url }) => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const postId = url.searchParams.get('postId');
  if (!postId) return json({ error: 'postId is required.' }, 400);

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';
  const res = await fetch(`${base}/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'delete failed'}` }, 502);
  }

  return json({ success: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
