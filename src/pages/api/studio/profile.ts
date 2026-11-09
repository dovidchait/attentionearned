export const prerender = false;

import type { APIRoute } from 'astro';
import { createClerkClient } from '@clerk/astro/server';

export const POST: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';
  const headers = {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };

  // Check Clerk metadata first — may already be set if session claims are stale
  const clerk = createClerkClient({ secretKey: import.meta.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(userId);
  const existing = (user.publicMetadata as { zernio_profile_id?: string }).zernio_profile_id;
  if (existing) return json({ profileId: existing });

  // Check if a Zernio profile already exists for this Clerk user
  const checkRes = await fetch(
    `${base}/profiles?externalId=${encodeURIComponent(userId)}&limit=1`,
    { headers },
  ).catch(() => null);

  if (checkRes?.ok) {
    const data = (await checkRes.json()) as
      | { data?: Array<{ _id: string }> }
      | Array<{ _id: string }>;
    const list = Array.isArray(data) ? data : (data.data ?? []);
    if (list.length > 0) {
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { zernio_profile_id: list[0]._id },
      });
      return json({ profileId: list[0]._id });
    }
  }

  // Create a new profile
  const createRes = await fetch(`${base}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ externalId: userId }),
  });

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    return json({ error: `Zernio ${createRes.status}: ${text || 'profile creation failed'}` }, 502);
  }

  const created = (await createRes.json()) as { _id?: string; profile?: { _id: string } };
  const profileId = created._id ?? created.profile?._id;
  if (!profileId) return json({ error: 'Zernio returned no profile ID.' }, 502);

  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: { zernio_profile_id: profileId },
  });

  return json({ profileId });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
