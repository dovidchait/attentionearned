export const prerender = false;

import type { APIRoute } from 'astro';
import { isStudioPlatform } from '../../../../../lib/studio/rules';
import { getStudioContext } from '../../../../../lib/studio/session';
import { getConnectRedirect } from '../../../../../lib/studio/zernio';

const backToAccounts = (message: string) =>
  new Response(null, { status: 302, headers: { Location: `/studio/accounts?error=${encodeURIComponent(message)}` } });

// Sends the browser to Zernio's OAuth page for one platform. Zernio returns the user to
// /api/studio/connect/callback with a connect_token.
export const GET: APIRoute = async (context) => {
  const platform = context.params.platform;
  if (!isStudioPlatform(platform)) return backToAccounts('Unknown platform.');

  try {
    const studio = await getStudioContext(context);
    if (!studio) {
      return new Response(null, { status: 302, headers: { Location: '/studio/login?redirect_url=/studio/accounts' } });
    }
    const redirectUrl = `${context.url.origin}/api/studio/connect/callback?platform=${platform}`;
    const authUrl = await getConnectRedirect(platform, studio.profileId, redirectUrl);
    return Response.redirect(authUrl, 302);
  } catch (err) {
    console.error('[studio] connect start failed for', platform);
    return backToAccounts(err instanceof Error ? err.message : 'Could not start the connection.');
  }
};
