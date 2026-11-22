export const prerender = false;

import type { APIRoute } from 'astro';
import { errorResponse, json, readJson, unauthorized } from '../../../../lib/studio/http';
import { validatePresign } from '../../../../lib/studio/rules';
import { getStudioContext } from '../../../../lib/studio/session';
import { presignZernioUpload } from '../../../../lib/studio/zernio';

// Returns a presigned URL. The browser then PUTs the file straight to Zernio storage, so
// large videos never pass through this function.
export const POST: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const checked = validatePresign(await readJson(context.request));
    if (!checked.ok) return json({ error: checked.error }, 400);

    const { uploadUrl, publicUrl } = await presignZernioUpload(
      checked.value.filename,
      checked.value.contentType,
      checked.value.size,
    );
    return json({ uploadUrl, publicUrl, kind: checked.value.kind, contentType: checked.value.contentType });
  } catch (err) {
    return errorResponse(err);
  }
};
