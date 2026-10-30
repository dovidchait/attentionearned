export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.IDEOGRAM_API_KEY;
  if (!apiKey?.trim()) return json({ error: 'IDEOGRAM_API_KEY not configured.' }, 500);

  let body: { prompt: string; style?: string; aspectRatio?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!body.prompt?.trim()) return json({ error: 'prompt is required.' }, 400);

  const res = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: {
      'Api-Key': apiKey.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_request: {
        prompt: body.prompt.trim(),
        aspect_ratio: body.aspectRatio ?? 'ASPECT_1_1',
        model: 'V_2',
        magic_prompt_option: 'AUTO',
        style_type: body.style ?? 'REALISTIC',
      },
    }),
  });

  if (res.status === 401) return json({ error: 'Invalid Ideogram API key.' }, 401);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json({ error: `Ideogram ${res.status}: ${text || 'generation failed'}` }, 502);
  }

  const data = (await res.json()) as {
    data?: Array<{ url: string; prompt: string }>;
  };
  const images = data.data ?? [];

  return json({ images: images.map((img) => ({ url: img.url, prompt: img.prompt })) });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
