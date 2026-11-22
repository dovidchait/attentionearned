export const prerender = false;

import type { APIRoute } from 'astro';
import { isStudioPlatform, SELECT_STEP_FOR } from '../../../../lib/studio/rules';
import { getStudioContext } from '../../../../lib/studio/session';
import { completeZernioConnectStep } from '../../../../lib/studio/zernio';

const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });
const toAccounts = (params: Record<string, string>) => redirect(`/studio/accounts?${new URLSearchParams(params)}`);

// Zernio sends the browser here after OAuth with ?connect_token=... on the URL we gave it.
export const GET: APIRoute = async (context) => {
  const platform = context.url.searchParams.get('platform') ?? '';
  const connectToken = context.url.searchParams.get('connect_token');
  const providerError = context.url.searchParams.get('error');

  if (!isStudioPlatform(platform)) return toAccounts({ error: 'Unknown platform.' });
  if (providerError) return toAccounts({ error: providerError.slice(0, 200) });
  if (!connectToken) return toAccounts({ error: 'The connection did not return a token. Try again.' });

  try {
    const studio = await getStudioContext(context);
    if (!studio) return redirect('/studio/login?redirect_url=/studio/accounts');

    const step = SELECT_STEP_FOR[platform];
    if (step) await completeZernioConnectStep(platform, step, connectToken, studio.profileId);
    return toAccounts({ connected: platform });
  } catch (err) {
    console.error('[studio] connect callback failed for', platform);
    return toAccounts({ error: err instanceof Error ? err.message : 'Could not finish the connection.' });
  }
};
