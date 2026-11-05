export const prerender = false;

import type { APIRoute } from 'astro';

interface ZernioPost {
  _id: string;
  id?: string;
  content?: string;
  status?: string;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt?: string;
  platforms?: Array<{ platform?: string; accountId?: string; status?: string; url?: string }>;
  mediaItems?: Array<{ url?: string; type?: string }>;
}

export const GET: APIRoute = async ({ url }) => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

  const page = url.searchParams.get('page') ?? '1';
  const limit = url.searchParams.get('limit') ?? '50';
  const status = url.searchParams.get('status') ?? '';

  const params = new URLSearchParams({ page, limit });
  if (status) params.set('status', status);

  let res: Response;
  try {
    res = await fetch(`${base}/posts?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return json({ error: `Network error: ${String(err)}` }, 502);
  }

  if (res.status === 401) return json({ error: 'Invalid Zernio API key.' }, 401);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'failed to list posts'}` }, 502);
  }

  const data = (await res.json()) as
    | ZernioPost[]
    | { data?: ZernioPost[]; posts?: ZernioPost[]; items?: ZernioPost[] };

  const raw: ZernioPost[] = Array.isArray(data)
    ? data
    : (data.data ?? data.posts ?? data.items ?? []);

  const posts = raw.map((p) => ({
    id: p._id ?? p.id,
    content: p.content ?? '',
    status: p.status ?? 'unknown',
    scheduledFor: p.scheduledFor ?? null,
    publishedAt: p.publishedAt ?? null,
    createdAt: p.createdAt ?? null,
    platforms: (p.platforms ?? []).map((pl) => ({
      platform: pl.platform,
      status: pl.status,
      url: pl.url,
    })),
    thumbnail: p.mediaItems?.[0]?.url ?? null,
  }));

  return json({ posts });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
