export const prerender = false;

import type { APIRoute } from 'astro';

interface AssemblyWord {
  text: string;
  confidence: number;
  start: number;
  end: number;
}

interface AssemblyTranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: AssemblyWord[];
  error?: string;
}

interface Captions {
  instagram: string;
  linkedin: string;
  firstComment: string;
}

async function generateCaptions(
  transcript: string,
  orgName: string,
  dayNumber: string,
  credits: string,
  anthropicKey: string,
): Promise<Captions> {
  const prompt = `You write social media captions for nonprofit organizations. Story-first. No hype. No hashtags. No buzzwords. No em dashes.

Organization: ${orgName || 'the organization'}
Day: ${dayNumber} of 30
Credits/people to mention: ${credits || 'none provided'}
Transcript: """
${transcript}
"""

Write two caption versions based strictly on what was said in the transcript.

INSTAGRAM/TIKTOK VERSION:
- 3–6 short lines
- Story-first — open with something that happened or was felt, not a claim
- Ends with a genuine question that invites a response
- Final line is exactly: Day ${dayNumber}/30
- No links, no hashtags
- Credit people by first name only if mentioned in credits above
- Never tag or guess handles

LINKEDIN VERSION:
- Same story, same structure
- No @ handles at all
- Slightly more direct tone is fine

Return ONLY valid JSON, no other text:
{"instagram": "...", "linkedin": "...", "firstComment": "Need people to know you? attentionearned.com"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}`);

  const data = (await res.json()) as { content?: Array<{ text: string }> };
  const text = data.content?.[0]?.text ?? '';

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');

  return JSON.parse(match[0]) as Captions;
}

export const GET: APIRoute = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');
  const orgName = url.searchParams.get('orgName') ?? '';
  const dayNumber = url.searchParams.get('dayNumber') ?? '1';
  const credits = url.searchParams.get('credits') ?? '';

  if (!jobId) return json({ error: 'jobId is required.' }, 400);

  const assemblyKey = import.meta.env.ASSEMBLYAI_API_KEY;
  const anthropicKey = url.searchParams.get('anthropicKey')?.trim() || import.meta.env.ANTHROPIC_API_KEY;

  if (!assemblyKey) return json({ error: 'ASSEMBLYAI_API_KEY not configured.' }, 500);
  if (!anthropicKey) return json({ error: 'Anthropic API key is required. Add yours to the form.' }, 400);

  const res = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
    headers: { Authorization: assemblyKey },
  });

  const data = (await res.json()) as AssemblyTranscript;

  if (data.status === 'error') {
    return json({ status: 'error', error: data.error ?? 'Transcription failed.' });
  }

  if (data.status !== 'completed') {
    return json({ status: data.status });
  }

  const flagged = (data.words ?? [])
    .filter((w) => w.confidence < 0.4)
    .map((w) => ({ text: w.text, confidence: Math.round(w.confidence * 100) }));

  let captions: Captions;
  try {
    captions = await generateCaptions(data.text ?? '', orgName, dayNumber, credits, anthropicKey);
  } catch {
    captions = {
      instagram: `Day ${dayNumber}/30`,
      linkedin: `Day ${dayNumber}/30`,
      firstComment: 'Need people to know you? attentionearned.com',
    };
  }

  return json({
    status: 'completed',
    transcript: data.text ?? '',
    flagged,
    instagram: captions.instagram,
    linkedin: captions.linkedin,
    firstComment: captions.firstComment,
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
