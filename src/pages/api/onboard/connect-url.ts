export const prerender = false;
import type { APIRoute } from 'astro';

const ALLOWED_PLATFORMS = new Set([
  'instagram', 'tiktok', 'youtube', 'linkedin', 'facebook', 'twitter',
]);

export const GET: APIRoute = async ({ url }) => {
  const platform = url.searchParams.get('platform')?.toLowerCase();
  const profileId = url.searchParams.get('profileId');

  if (!platform || !ALLOWED_PLATFORMS.has(platform)) {
    return new Response(JSON.stringify({ error: 'Invalid platform' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!profileId) {
    return new Response(JSON.stringify({ error: 'Missing profileId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = url.origin;
  const redirectUrl = `${origin}/signup?step=2&connected=${platform}`;

  const connectUrl =
    `https://zernio.com/api/v1/connect/${encodeURIComponent(platform)}` +
    `?profileId=${encodeURIComponent(profileId)}` +
    `&redirect_url=${encodeURIComponent(redirectUrl)}`;

  return new Response(JSON.stringify({ connectUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
