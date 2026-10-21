export const prerender = false;

// Vercel Pro: bump timeout for video scheduling round-trips
export const maxDuration = 60;

import type { APIRoute } from 'astro';

interface PlatformPost {
  accountId: string;
  caption: string;
}

interface PostBody {
  apiKey: string;
  videoUrl: string;
  platforms: PlatformPost[];  // each entry is one account + its caption
  scheduledFor: string;       // ISO 8601
}

export const POST: APIRoute = async ({ request }) => {
  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { apiKey, videoUrl, platforms, scheduledFor } = body;

  if (!apiKey?.trim()) return json({ error: 'apiKey is required.' }, 400);
  if (!videoUrl?.trim()) return json({ error: 'videoUrl is required.' }, 400);
  if (!platforms?.length) return json({ error: 'At least one platform/account is required.' }, 400);
  if (!scheduledFor) return json({ error: 'scheduledFor is required.' }, 400);

  // Group accounts by caption so we minimise API calls
  const captionGroups = new Map<string, string[]>();
  for (const p of platforms) {
    const ids = captionGroups.get(p.caption) ?? [];
    ids.push(p.accountId);
    captionGroups.set(p.caption, ids);
  }

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';
  const headers = {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };

  const postIds: string[] = [];
  const errors: string[] = [];

  for (const [caption, accountIds] of captionGroups) {
    const payload = {
      content: caption,
      mediaItems: [{ url: videoUrl.trim(), type: 'video' }],
      platforms: accountIds.map((id) => ({ accountId: id })),
      scheduledFor,
    };

    let res: Response;
    try {
      res = await fetch(`${base}/posts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      errors.push(`Network error: ${String(err)}`);
      continue;
    }

    if (res.status === 401) {
      return json({ error: 'Invalid Zernio API key.' }, 401);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      errors.push(`Zernio ${res.status}: ${text || 'post creation failed'}`);
      continue;
    }

    const data = (await res.json()) as { _id?: string; id?: string; postId?: string };
    const id = data._id ?? data.id ?? data.postId ?? 'ok';
    postIds.push(id);
  }

  if (errors.length && !postIds.length) {
    return json({ error: errors.join(' | ') }, 502);
  }

  return json({ success: true, postIds, errors: errors.length ? errors : undefined });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
