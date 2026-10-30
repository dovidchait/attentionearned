export const prerender = false;

import type { APIRoute } from 'astro';

const SUPPORTED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'twitter', 'youtube', 'pinterest'];

export const GET: APIRoute = async ({ url }) => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  const platform = url.searchParams.get('platform')?.toLowerCase();
  const profileId = url.searchParams.get('profileId');
  const redirectUrl = url.searchParams.get('redirect_url');

  if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
    return json({ error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}` }, 400);
  }
  if (!profileId?.trim()) return json({ error: 'profileId is required.' }, 400);

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

  // Build the redirect_url — Zernio will send the user here after OAuth
  const callbackUrl =
    redirectUrl ||
    `${url.origin}/api/zernio/callback?profileId=${encodeURIComponent(profileId)}`;

  // Redirect the user to Zernio's hosted OAuth connect screen
  const connectUrl = `${base}/connect/${encodeURIComponent(platform)}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(callbackUrl)}`;

  return new Response(null, {
    status: 302,
    headers: { Location: connectUrl },
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
