export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  let body: { externalId: string; name?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!body.externalId?.trim()) return json({ error: 'externalId is required.' }, 400);

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';
  const headers = { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' };

  // Check if a profile already exists for this externalId
  const listRes = await fetch(
    `${base}/profiles?externalId=${encodeURIComponent(body.externalId)}&limit=1`,
    { headers },
  ).catch(() => null);

  if (listRes?.ok) {
    const listData = (await listRes.json()) as
      | { data?: Array<{ _id: string }>; profiles?: Array<{ _id: string }> }
      | Array<{ _id: string }>;
    const profiles = Array.isArray(listData)
      ? listData
      : ((listData as { data?: Array<{ _id: string }> }).data ??
        (listData as { profiles?: Array<{ _id: string }> }).profiles ??
        []);
    if (profiles[0]?._id) {
      return json({ profileId: profiles[0]._id, created: false });
    }
  }

  // Create new profile
  const createRes = await fetch(`${base}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      externalId: body.externalId.trim(),
      ...(body.name ? { name: body.name } : {}),
      ...(body.email ? { email: body.email } : {}),
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    return json({ error: `Zernio ${createRes.status}: ${text || 'failed to create profile'}` }, 502);
  }

  const data = (await createRes.json()) as
    | { _id?: string; id?: string; profile?: { _id: string } };
  const profileId = data._id ?? data.id ?? (data as { profile?: { _id: string } }).profile?._id;
  if (!profileId) return json({ error: 'Zernio returned no profile ID.' }, 502);

  return json({ profileId, created: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
