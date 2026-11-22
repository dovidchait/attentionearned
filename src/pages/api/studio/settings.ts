export const prerender = false;

import type { APIRoute } from 'astro';
import { errorResponse, json, readJson, unauthorized } from '../../../lib/studio/http';
import { validateSettings } from '../../../lib/studio/rules';
import { getStudioContext, saveStudioMetadata } from '../../../lib/studio/session';

export const GET: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();
    return json({ settings: studio.settings });
  } catch (err) {
    return errorResponse(err);
  }
};

export const PUT: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const checked = validateSettings(await readJson(context.request));
    if (!checked.ok) return json({ error: checked.error }, 400);

    await saveStudioMetadata(context, studio.userId, { settings: checked.value });
    return json({ settings: checked.value });
  } catch (err) {
    return errorResponse(err);
  }
};
