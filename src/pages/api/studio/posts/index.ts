export const prerender = false;
export const maxDuration = 60;

import type { APIRoute } from 'astro';
import { errorResponse, json, readJson, unauthorized } from '../../../../lib/studio/http';
import {
  groupByCaption,
  isSubmissionId,
  validateMedia,
  validateSchedule,
  validateTargets,
} from '../../../../lib/studio/rules';
import { getStudioContext } from '../../../../lib/studio/session';
import { createZernioPost, listZernioAccounts } from '../../../../lib/studio/zernio';

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

export const POST: APIRoute = async (context) => {
  try {
    const studio = await getStudioContext(context);
    if (!studio) return unauthorized();

    const body = (await readJson(context.request)) as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') return json({ error: 'Request body must be JSON.' }, 400);

    if (!isSubmissionId(body.submissionId)) return json({ error: 'submissionId is missing or invalid.' }, 400);
    const submissionId = body.submissionId;

    const targets = validateTargets(body.targets);
    if (!targets.ok) return json({ error: targets.error }, 400);
    const media = validateMedia(body.media);
    if (!media.ok) return json({ error: media.error }, 400);
    const schedule = validateSchedule({
      publishNow: body.publishNow,
      scheduledFor: body.scheduledFor,
      timezone: body.timezone,
    });
    if (!schedule.ok) return json({ error: schedule.error }, 400);

    // Every target must be an active account on this client's own profile.
    const accounts = new Map(
      (await listZernioAccounts(studio.profileId)).filter((a) => a.active).map((a) => [a.id, a] as const),
    );
    const resolved: Array<{ accountId: string; platform: string; caption: string }> = [];
    for (const target of targets.value) {
      const account = accounts.get(target.accountId);
      if (!account) return json({ error: 'One of those accounts is not connected to your profile.' }, 400);
      resolved.push({ accountId: account.id, platform: account.platform, caption: target.caption });
    }

    const postIds: string[] = [];
    const errors: string[] = [];

    for (const group of groupByCaption(resolved)) {
      const payload: Record<string, unknown> = {
        content: group.caption,
        platforms: group.items.map((item) => ({ platform: item.platform, accountId: item.accountId })),
        mediaItems: [{ url: media.value.url, type: media.value.type }],
        metadata: { source: 'studio', submissionId },
        ...(schedule.value.publishNow
          ? { publishNow: true }
          : { scheduledFor: schedule.value.scheduledFor, timezone: schedule.value.timezone }),
      };

      // The key covers the submission and this exact payload. A retry of the same request
      // returns the original post. A changed caption or time gets a new key, so it is never
      // swallowed by an earlier attempt.
      const key = `studio-${studio.profileId}-${submissionId}-${await fingerprint(
        JSON.stringify({ payload, targets: group.items.map((i) => i.accountId) }),
      )}`;

      const res = await createZernioPost(payload, key);
      if (res.status >= 200 && res.status < 300) {
        const id = res.data?.post?._id ?? res.data?._id ?? res.data?.id ?? res.data?.post?.id;
        if (typeof id === 'string') postIds.push(id);
      } else if (res.status === 409) {
        errors.push('That caption was already posted to one of these accounts in the last 24 hours.');
      } else {
        errors.push(String(res.data?.message ?? res.data?.error ?? `Zernio answered ${res.status}.`));
      }
    }

    const ok = errors.length === 0;
    return json({ ok, postIds, errors }, postIds.length === 0 && !ok ? 502 : 200);
  } catch (err) {
    return errorResponse(err);
  }
};
