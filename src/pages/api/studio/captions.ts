export const prerender = false;
export const maxDuration = 60;

import type { APIRoute } from 'astro';
import { generateCaptions } from '../../../lib/studio/captions';
import { errorResponse, json, readJson, unauthorized } from '../../../lib/studio/http';
import { getStudioContext } from '../../../lib/studio/session';

const MAX_TRANSCRIPT_CHARS = 30_000;

export const POST: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const body = (await readJson(context.request)) as { transcript?: unknown } | undefined;
    const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
    if (!transcript) return json({ error: 'transcript is required.' }, 400);
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return json({ error: 'That transcript is too long. Trim the video or split it.' }, 400);
    }

    // Voice and campaign settings come from the server-side record, not from the request.
    const captions = await generateCaptions(transcript, studio.settings);
    return json(captions);
  } catch (err) {
    return errorResponse(err);
  }
};
