// Graphic generation for the Studio (Ideogram).
//
// UNVERIFIED: the Ideogram developer docs (developer.ideogram.ai) were not reachable from
// the session that wrote this. The endpoint, the request body and the response path below
// come from the public API references and have not been checked against a live key.
// Confirm all three before relying on this step.

import { ideogramApiKey } from './env';
import { StudioApiError } from './http';

export const ASPECT_RATIOS = ['1x1', '4x5', '9x16', '16x9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Returns hosted image URLs from Ideogram. Each call makes one image. */
export async function generateIdeogramImages(prompt: string, aspectRatio: AspectRatio, count: number): Promise<string[]> {
  const key = ideogramApiKey();
  if (!key) throw new StudioApiError('Graphics are not set up yet (IDEOGRAM_API_KEY is missing).', 503);

  const requests = Array.from({ length: count }, async () => {
    const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, aspect_ratio: aspectRatio, rendering_speed: 'DEFAULT' }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new StudioApiError(`Graphic generation failed (Ideogram ${res.status}).`, 502);
    const data = (await res.json()) as { data?: Array<{ url?: unknown }> };
    const url = data.data?.[0]?.url;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  });

  const settled = await Promise.allSettled(requests);
  const urls = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  if (urls.length === 0) throw new StudioApiError('Graphic generation returned no images. Try a different description.', 502);
  return urls;
}
