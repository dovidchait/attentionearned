export const prerender = false;
export const maxDuration = 60;

import type { APIRoute } from 'astro';
import { ASPECT_RATIOS, generateIdeogramImages, type AspectRatio } from '../../../lib/studio/ideogram';
import { errorResponse, json, readJson, StudioApiError, unauthorized } from '../../../lib/studio/http';
import { getStudioContext } from '../../../lib/studio/session';
import { uploadBytesToZernio } from '../../../lib/studio/zernio';

const MAX_PROMPT_CHARS = 1000;
const IMAGE_COUNT = 2;

// Generates images, copies each into Zernio storage (Ideogram's URLs are not ours to keep),
// and returns the Zernio URLs the user can pick from.
export const POST: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const body = (await readJson(context.request)) as { prompt?: unknown; aspectRatio?: unknown } | undefined;
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (prompt.length < 5) return json({ error: 'Describe the graphic in a sentence or two.' }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Keep the description under 1,000 characters.' }, 400);

    const aspect = (ASPECT_RATIOS as readonly string[]).includes(String(body?.aspectRatio))
      ? (body?.aspectRatio as AspectRatio)
      : '1x1';

    const sourceUrls = await generateIdeogramImages(prompt, aspect, IMAGE_COUNT);

    const images: Array<{ url: string; type: 'image' }> = [];
    for (const [index, sourceUrl] of sourceUrls.entries()) {
      try {
        const fetched = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
        if (!fetched.ok) continue;
        const contentType = fetched.headers.get('content-type')?.split(';')[0] ?? 'image/png';
        if (!contentType.startsWith('image/')) continue;
        const bytes = await fetched.arrayBuffer();
        const url = await uploadBytesToZernio(bytes, contentType, `studio-graphic-${index + 1}.png`);
        images.push({ url, type: 'image' });
      } catch {
        // One failed copy should not hide the others.
      }
    }

    if (images.length === 0) throw new StudioApiError('The graphics could not be saved. Try again.', 502);
    return json({ images });
  } catch (err) {
    return errorResponse(err);
  }
};
