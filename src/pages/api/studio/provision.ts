export const prerender = false;

import type { APIRoute } from 'astro';
import { clerkClient } from '@clerk/astro/server';

const ZERNIO_BASE = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

export const POST: APIRoute = async (context) => {
  const { userId } = context.locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const clerk = clerkClient(context);

  // Check if profile already exists in Clerk private metadata
  const user = await clerk.users.getUser(userId);
  const existingProfileId = (user.privateMetadata as Record<string, unknown>)?.zernioProfileId as string | undefined;

  if (existingProfileId) {
    return json({ profileId: existingProfileId, created: false });
  }

  // Create a new Zernio profile for this user
  const res = await fetch(`${ZERNIO_BASE}/profiles`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ externalId: userId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'profile creation failed'}` }, 502);
  }

  const data = (await res.json()) as { _id?: string; id?: string };
  const profileId = data._id ?? data.id;

  if (!profileId) {
    return json({ error: 'Zernio returned no profile ID.' }, 502);
  }

  // Store in Clerk private metadata
  await clerk.users.updateUserMetadata(userId, {
    privateMetadata: { zernioProfileId: profileId },
  });

  return json({ profileId, created: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
