export const prerender = false;

import type { APIRoute } from 'astro';
import { errorResponse, json, unauthorized } from '../../../lib/studio/http';
import { getStudioContext } from '../../../lib/studio/session';
import { listZernioAccounts } from '../../../lib/studio/zernio';

export const GET: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();
    const accounts = (await listZernioAccounts(studio.profileId)).filter((a) => a.active);
    return json({ accounts: accounts.map(({ id, platform, label }) => ({ id, platform, label })) });
  } catch (err) {
    return errorResponse(err);
  }
};
