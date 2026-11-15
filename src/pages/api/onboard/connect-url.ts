export const prerender = false;
import type { APIRoute } from 'astro';

const ALLOWED_PLATFORMS = new Set([
  'instagram', 'tiktok', 'youtube', 'linkedin', 'facebook', 'twitter',
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ url }) => {
  const platform = url.searchParams.get('platform')?.toLowerCase();
  const profileId = url.searchParams.get('profileId');

  if (!platform || !ALLOWED_PLATFORMS.has(platform)) {
    return json({ error: 'Invalid platform' }, 400);
  }
  if (!profileId) {
    return json({ error: 'Missing profileId' }, 400);
  }

  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey) {
    return json({ error: 'Service not configured' }, 503);
  }

  // Zernio's connect endpoint requires a Bearer key, so it must be called
  // server-side. The browser cannot be sent there directly (that is what
  // produced "Missing API key" from zernio.com). Zernio returns an authUrl
  // for the browser to follow.
  const redirectUrl = `${url.origin}/signup?step=2&connected=${platform}`;
  const apiUrl =
    `https://zernio.com/api/v1/connect/${encodeURIComponent(platform)}` +
    `?profileId=${encodeURIComponent(profileId)}` +
    `&redirect_url=${encodeURIComponent(redirectUrl)}`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'manual',
    });
  } catch {
    return json({ error: 'Could not reach Zernio' }, 502);
  }

  // Zernio may answer with JSON (authUrl) or with a redirect to the OAuth page.
  const location = res.headers.get('location');
  if (location && res.status >= 300 && res.status < 400) {
    return json({ connectUrl: location });
  }

  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const msg = data?.message || data?.error || `Zernio returned ${res.status}`;
    return json({ error: msg }, res.status >= 500 ? 502 : 400);
  }

  const connectUrl = data?.authUrl || data?.url || data?.connectUrl;
  if (!connectUrl) {
    console.error('[connect-url] No authUrl in Zernio response. Keys:', data && typeof data === 'object' ? Object.keys(data).join(', ') : typeof data);
    return json({ error: 'Zernio response had no authUrl' }, 502);
  }

  return json({ connectUrl });
};
