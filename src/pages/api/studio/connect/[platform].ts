export const prerender = false;

import type { APIRoute } from 'astro';

const ZERNIO_BASE = () => import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

const SUPPORTED_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'tiktok',
  'twitter',
  'youtube',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/studio/connect/{platform}?profileId=<id>
//
// Calls Zernio's connect endpoint to get the OAuth redirect URL for the platform,
// then 302s the user's browser to it. Zernio handles the branded OAuth screen
// and redirects back to /api/studio/connect/callback when done.
export const GET: APIRoute = async ({ params, url, request, cookies }) => {
  const platform = params.platform?.toLowerCase();
  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return json({ error: `Unsupported platform: ${platform}` }, 400);
  }

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured' }, 500);

  // profileId: query param takes priority, then cookie fallback
  const profileId = url.searchParams.get('profileId') ?? cookies.get('zernio_profile_id')?.value;
  if (!profileId) {
    return json({ error: 'profileId is required. Provision a profile first via POST /api/studio/profile.' }, 400);
  }

  const origin = new URL(request.url).origin;
  const callbackUrl = `${origin}/api/studio/connect/callback?platform=${platform}&profileId=${encodeURIComponent(profileId)}`;

  // Ask Zernio for the OAuth URL for this platform+profile
  const connectUrl = new URL(`${ZERNIO_BASE()}/connect/${platform}`);
  connectUrl.searchParams.set('profileId', profileId);
  connectUrl.searchParams.set('redirect_url', callbackUrl);

  const res = await fetch(connectUrl.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) return json({ error: 'Invalid Zernio API key' }, 401);
  if (res.status === 404) return json({ error: `Platform ${platform} not configured in your Zernio account` }, 404);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'failed to get connect URL'}` }, 502);
  }

  // Zernio returns the OAuth redirect URL
  const data = await res.json();
  const redirectTarget: string = data.url ?? data.connectUrl ?? data.redirect_url ?? data.authUrl ?? '';

  if (!redirectTarget) {
    return json({ error: 'Zernio did not return a connect URL' }, 502);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: redirectTarget },
  });
};
