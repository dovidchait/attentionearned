export const prerender = false;

import type { APIRoute } from 'astro';

const ZERNIO_BASE = () => import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

function zernioHeaders() {
  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) throw new Error('ZERNIO_API_KEY not configured');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/studio/profile?externalId=<clerkUserId>
// Returns the Zernio profile for this user, or 404 if none exists yet.
export const GET: APIRoute = async ({ url }) => {
  const externalId = url.searchParams.get('externalId');
  if (!externalId) return json({ error: 'externalId is required' }, 400);

  let headers: ReturnType<typeof zernioHeaders>;
  try {
    headers = zernioHeaders();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  const res = await fetch(`${ZERNIO_BASE()}/profiles?externalId=${encodeURIComponent(externalId)}`, {
    headers,
  });

  if (res.status === 401) return json({ error: 'Invalid Zernio API key' }, 401);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'error fetching profile'}` }, 502);
  }

  const data = await res.json();

  // Zernio may return { data: [...] } or a bare array
  const profiles: Array<{ _id: string; externalId: string; name?: string }> = Array.isArray(data)
    ? data
    : (data.data ?? data.profiles ?? []);

  const profile = profiles.find((p) => p.externalId === externalId);
  if (!profile) return json({ profile: null }, 404);

  return json({ profile: { id: profile._id, externalId: profile.externalId, name: profile.name } });
};

// POST /api/studio/profile
// Body: { externalId: string, name?: string }
// Idempotent: returns existing profile if one already exists for this externalId.
// Sets a httpOnly cookie with the profile ID for use in subsequent requests
// until Clerk metadata is wired up.
export const POST: APIRoute = async ({ request }) => {
  let body: { externalId?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { externalId, name } = body;
  if (!externalId?.trim()) return json({ error: 'externalId is required' }, 400);

  let headers: ReturnType<typeof zernioHeaders>;
  try {
    headers = zernioHeaders();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  // Check if profile already exists
  const checkRes = await fetch(
    `${ZERNIO_BASE()}/profiles?externalId=${encodeURIComponent(externalId)}`,
    { headers },
  );

  if (checkRes.ok) {
    const checkData = await checkRes.json();
    const profiles: Array<{ _id: string; externalId: string; name?: string }> = Array.isArray(checkData)
      ? checkData
      : (checkData.data ?? checkData.profiles ?? []);
    const existing = profiles.find((p) => p.externalId === externalId);
    if (existing) {
      return profileResponse(existing._id, existing.externalId, existing.name, true);
    }
  }

  // Create new profile
  const createRes = await fetch(`${ZERNIO_BASE()}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ externalId: externalId.trim(), name: name?.trim() ?? externalId.trim() }),
  });

  if (createRes.status === 401) return json({ error: 'Invalid Zernio API key' }, 401);

  if (createRes.status === 409) {
    // Race: profile was just created between our check and POST
    const data = await createRes.json().catch(() => ({}));
    const profileId: string = data._id ?? data.id ?? data.profileId ?? '';
    return profileResponse(profileId, externalId, name, true);
  }

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    return json({ error: `Zernio ${createRes.status}: ${text || 'failed to create profile'}` }, 502);
  }

  const created = await createRes.json();
  const profileId: string = created._id ?? created.id ?? created.profileId ?? '';
  if (!profileId) return json({ error: 'Zernio returned no profile ID' }, 502);

  return profileResponse(profileId, externalId, name, false);
};

function profileResponse(profileId: string, externalId: string, name: string | undefined, existed: boolean) {
  const body = JSON.stringify({
    profile: { id: profileId, externalId, name },
    existed,
  });
  // httpOnly cookie so the connect page can pass profileId without JS-accessible storage.
  // Replace with Clerk metadata lookup once auth is wired up.
  const cookieAge = 60 * 60 * 24 * 90; // 90 days
  return new Response(body, {
    status: existed ? 200 : 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `zernio_profile_id=${profileId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieAge}`,
    },
  });
}
