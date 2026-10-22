export const prerender = false;

import type { APIRoute } from 'astro';

// Ideogram API: https://developer.ideogram.ai
// Requires IDEOGRAM_API_KEY in env.

export const POST: APIRoute = async ({ request, locals }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const apiKey = import.meta.env.IDEOGRAM_API_KEY?.trim();
  if (!apiKey) {
    return json({ error: 'IDEOGRAM_API_KEY not configured. Add it to your environment variables.' }, 500);
  }

  let body: { prompt: string; aspectRatio?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  if (!body.prompt?.trim()) {
    return json({ error: 'prompt is required.' }, 400);
  }

  const res = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_request: {
        prompt: body.prompt.trim(),
        aspect_ratio: body.aspectRatio ?? 'ASPECT_1_1',
        model: 'V_2',
        magic_prompt_option: 'AUTO',
        num_images: 4,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Ideogram ${res.status}: ${text || 'generation failed'}` }, 502);
  }

  const data = (await res.json()) as { data?: Array<{ url: string }> };
  const images = (data.data ?? []).map((img) => img.url);

  return json({ images });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
