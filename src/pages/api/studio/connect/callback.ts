export const prerender = false;

import type { APIRoute } from 'astro';

const ZERNIO_BASE = () => import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function redirectTo(path: string, status = 302) {
  return new Response(null, { status, headers: { Location: path } });
}

// GET /api/studio/connect/callback
//
// Zernio redirects here after the user completes OAuth for a platform.
// Expected query params from Zernio:
//   - connect_token: short-lived token to complete the connection server-side
//   - step: what selection is needed next (e.g. 'done', 'select_page', 'select_account')
//   - platform: which platform just connected (also set by us when we built the callbackUrl)
//   - profileId: the Zernio profile ID (set by us when we built the callbackUrl)
//   - error: set by Zernio if the user cancelled or auth failed
export const GET: APIRoute = async ({ url, request }) => {
  const params = url.searchParams;

  // User cancelled or Zernio reported an error
  const error = params.get('error');
  if (error) {
    const msg = encodeURIComponent(params.get('error_description') ?? error);
    return redirectTo(`/studio/connect?error=${msg}`);
  }

  const connectToken = params.get('connect_token') ?? params.get('code');
  const step = params.get('step') ?? 'done';
  const platform = params.get('platform');
  const profileId = params.get('profileId');

  if (!connectToken) return redirectTo('/studio/connect?error=missing_connect_token');
  if (!platform) return redirectTo('/studio/connect?error=missing_platform');
  if (!profileId) return redirectTo('/studio/connect?error=missing_profile_id');

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured' }, 500);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // If step is 'done' (or Zernio omits it), call the select endpoint to finalise
  // the connection — no additional user input needed.
  if (step === 'done' || step === 'connected') {
    const res = await fetch(`${ZERNIO_BASE()}/connect/${platform}/select`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ connect_token: connectToken, profileId, step }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const msg = encodeURIComponent(`Zernio ${res.status}: ${text || 'failed to finalise connection'}`);
      return redirectTo(`/studio/connect?error=${msg}`);
    }

    return redirectTo(`/studio/connect?connected=${encodeURIComponent(platform)}`);
  }

  // Steps that require the user to pick something (Facebook page selection, etc.)
  // POST to Zernio to get the available options, then show our selection UI.
  const selectRes = await fetch(`${ZERNIO_BASE()}/connect/${platform}/select`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ connect_token: connectToken, profileId, step }),
  });

  if (!selectRes.ok) {
    const text = await selectRes.text().catch(() => '');
    const msg = encodeURIComponent(`Zernio ${selectRes.status}: ${text || 'failed to load selection options'}`);
    return redirectTo(`/studio/connect?error=${msg}`);
  }

  const selectData = await selectRes.json();

  // Options may come back as { accounts: [...] }, { pages: [...] }, or { data: [...] }
  const options: Array<{ id: string; name: string; picture?: string }> =
    selectData.accounts ?? selectData.pages ?? selectData.data ?? selectData.options ?? [];

  if (!options.length) {
    // No options returned — treat as done (Zernio handled it automatically)
    return redirectTo(`/studio/connect?connected=${encodeURIComponent(platform)}`);
  }

  // Redirect to the selection page with the data encoded in the URL.
  // The select page will POST back to /api/studio/connect/select.
  const origin = new URL(request.url).origin;
  const selectionUrl = new URL(`${origin}/studio/connect/select`);
  selectionUrl.searchParams.set('platform', platform);
  selectionUrl.searchParams.set('profileId', profileId);
  selectionUrl.searchParams.set('connect_token', connectToken);
  selectionUrl.searchParams.set('step', step);
  selectionUrl.searchParams.set('options', JSON.stringify(options));

  return new Response(null, { status: 302, headers: { Location: selectionUrl.toString() } });
};
