export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const assemblyKey = import.meta.env.ASSEMBLYAI_API_KEY;
  if (!assemblyKey) {
    return json({ error: 'ASSEMBLYAI_API_KEY not configured.' }, 500);
  }

  let body: { videoUrl: string; wordBoost?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!body.videoUrl?.trim()) {
    return json({ error: 'videoUrl is required.' }, 400);
  }

  const res = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      Authorization: assemblyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: body.videoUrl.trim(),
      ...(body.wordBoost?.length
        ? { word_boost: body.wordBoost, boost_param: 'high' }
        : {}),
    }),
  });

  const data = (await res.json()) as { id?: string; error?: string };

  if (!res.ok || !data.id) {
    return json({ error: data.error ?? 'AssemblyAI rejected the request.' }, 502);
  }

  return json({ jobId: data.id });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
