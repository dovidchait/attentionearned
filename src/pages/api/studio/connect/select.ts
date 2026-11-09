export const prerender = false;

import type { APIRoute } from 'astro';

const ZERNIO_BASE = () => import.meta.env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/studio/connect/select
//
// Finalises a multi-step connect flow (e.g. Facebook page selection).
// Called by the selection UI page after the user picks an account/page.
//
// Body: { connect_token, profileId, platform, step, selection_id }
export const POST: APIRoute = async ({ request }) => {
  let body: {
    connect_token?: string;
    profileId?: string;
    platform?: string;
    step?: string;
    selection_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { connect_token, profileId, platform, step, selection_id } = body;

  if (!connect_token) return json({ error: 'connect_token is required' }, 400);
  if (!profileId) return json({ error: 'profileId is required' }, 400);
  if (!platform) return json({ error: 'platform is required' }, 400);
  if (!selection_id) return json({ error: 'selection_id is required' }, 400);

  const apiKey = import.meta.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return json({ error: 'ZERNIO_API_KEY not configured' }, 500);

  const res = await fetch(`${ZERNIO_BASE()}/connect/${platform}/select`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connect_token,
      profileId,
      step: step ?? 'select_page',
      selection_id,
    }),
  });

  if (res.status === 401) return json({ error: 'Invalid Zernio API key' }, 401);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Zernio ${res.status}: ${text || 'failed to finalise selection'}` }, 502);
  }

  const data = await res.json();

  // If Zernio returns another step, we surface it so the UI can handle it
  const nextStep: string | undefined = data.step ?? data.next_step;
  const nextOptions: unknown[] = data.accounts ?? data.pages ?? data.data ?? data.options ?? [];

  if (nextStep && nextStep !== 'done' && nextStep !== 'connected' && nextOptions.length > 0) {
    return json({ success: false, nextStep, options: nextOptions });
  }

  return json({ success: true, platform, accountId: data._id ?? data.id ?? data.accountId });
};
