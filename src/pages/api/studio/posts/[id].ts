export const prerender = false;

import type { APIRoute } from 'astro';
import { errorResponse, json, readJson, StudioApiError, unauthorized } from '../../../../lib/studio/http';
import { ID_PATTERN, MAX_CAPTION_CHARS, postBelongsToProfile, validateSchedule } from '../../../../lib/studio/rules';
import { getStudioContext } from '../../../../lib/studio/session';
import {
  deleteZernioPost,
  getZernioPost,
  listZernioAccounts,
  updateZernioPost,
} from '../../../../lib/studio/zernio';

// A post that is not on the caller's profile gets the same answer as a missing one.
async function assertOwnsPost(profileId: string, postId: string): Promise<void> {
  const post = await getZernioPost(postId);
  if (!post) throw new StudioApiError('That post was not found.', 404);
  const accountIds = new Set((await listZernioAccounts(profileId)).map((a) => a.id));
  if (!postBelongsToProfile(post, profileId, accountIds)) throw new StudioApiError('That post was not found.', 404);
}

export const PUT: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const postId = context.params.id ?? '';
    if (!ID_PATTERN.test(postId)) return json({ error: 'Invalid post id.' }, 400);

    const body = (await readJson(context.request)) as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') return json({ error: 'Request body must be JSON.' }, 400);

    const updates: Record<string, unknown> = {};

    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || !body.content.trim()) {
        return json({ error: 'The caption cannot be empty.' }, 400);
      }
      if (body.content.trim().length > MAX_CAPTION_CHARS) {
        return json({ error: `Captions must be ${MAX_CAPTION_CHARS} characters or fewer.` }, 400);
      }
      updates.content = body.content.trim();
    }

    if (body.scheduledFor !== undefined) {
      const schedule = validateSchedule({
        publishNow: false,
        scheduledFor: body.scheduledFor,
        timezone: body.timezone,
      });
      if (!schedule.ok) return json({ error: schedule.error }, 400);
      if (schedule.value.publishNow) return json({ error: 'Pick a date and time.' }, 400);
      updates.scheduledFor = schedule.value.scheduledFor;
      updates.timezone = schedule.value.timezone;
    }

    if (Object.keys(updates).length === 0) return json({ error: 'Nothing to update.' }, 400);

    await assertOwnsPost(studio.profileId, postId);
    await updateZernioPost(postId, updates);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const postId = context.params.id ?? '';
    if (!ID_PATTERN.test(postId)) return json({ error: 'Invalid post id.' }, 400);

    await assertOwnsPost(studio.profileId, postId);
    await deleteZernioPost(postId);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
