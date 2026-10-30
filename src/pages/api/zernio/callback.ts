export const prerender = false;

import type { APIRoute } from 'astro';

// GET: landing page after Zernio OAuth — may include a select step (e.g. pick a Facebook page)
export const GET: APIRoute = async ({ url }) => {
  const connectToken = url.searchParams.get('connect_token');
  const step = url.searchParams.get('step');
  const profileId =
    url.searchParams.get('profileId') ?? url.searchParams.get('profile_id') ?? '';
  const error = url.searchParams.get('error');

  if (error) {
    return redirect(`/studio/connect?error=${encodeURIComponent(error)}&profileId=${encodeURIComponent(profileId)}`);
  }

  if (!connectToken) {
    return redirect(`/studio/connect?error=missing_token&profileId=${encodeURIComponent(profileId)}`);
  }

  // If Zernio requires a further selection step, forward params to the UI
  if (step) {
    const params = new URLSearchParams({ connect_token: connectToken, step });
    if (profileId) params.set('profileId', profileId);
    return redirect(`/studio/connect?${params.toString()}`);
  }

  // Connection complete — return to connect page
  const params = new URLSearchParams({ connected: '1' });
  if (profileId) params.set('profileId', profileId);
  return redirect(`/studio/connect?${params.toString()}`);
};

// POST: advance a select step (e.g. confirm which Facebook page to use)
export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'ZERNIO_API_KEY not configured.' }, 500);

  let body: {
    connectToken: string;
    step: string;
    selection: string;
    profileId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { connectToken, step, selection, profileId } = body;
  if (!connectToken || !step || !selection) {
    return json({ error: 'connectToken, step, and selection are required.' }, 400);
  }

  const base = import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';
  const res = await fetch(`${base}/connect/select`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connectToken,
      step,
      selection,
      ...(profileId ? { profileId } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'select step failed'}` }, 502);
  }

  const data = (await res.json()) as { nextStep?: string; done?: boolean };
  return json(data);
};

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
