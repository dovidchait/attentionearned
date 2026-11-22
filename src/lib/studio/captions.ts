// Caption drafts for Instagram, LinkedIn and TikTok, written from the transcript and the
// organization's voice settings.

import { anthropicApiKey } from './env';
import { StudioApiError } from './http';
import type { OrgSettings } from './rules';

export interface CaptionSet {
  instagram: string;
  linkedin: string;
  tiktok: string;
}

export function captionPrompt(transcript: string, settings: OrgSettings): string {
  const campaign = settings.currentCampaign || 'none named';
  const day = settings.campaignDay ? `Campaign day: ${settings.campaignDay} of 30.` : 'No campaign day is set.';

  return `You write social media captions for ${settings.orgName || 'a small organization'}.

Voice and tone (follow it closely): ${settings.voiceTone || 'Warm, direct, story-first. Sounds like a real person, not a brand.'}
Current campaign: ${campaign}. ${day}

House rules: story-first. No hype. No buzzwords. No hashtags. No links. No em dashes. Never tag or guess handles. Credit people by first name only, and only if the transcript names them.
Base every line strictly on the transcript. Do not invent facts, names, places or numbers.

Transcript:
"""
${transcript}
"""

Write three captions:
- instagram: 3 to 6 short lines. Open with something that happened or was felt, not a claim. End with a genuine question. If a campaign day is set, the final line must be exactly "Day N/30" with N set to the campaign day.
- linkedin: the same story in a slightly more direct tone. No @ handles.
- tiktok: 1 to 3 short, spoken-style lines. The first line has to hook within the first second. End with a question.

Return ONLY valid JSON, no other text:
{"instagram": "...", "linkedin": "...", "tiktok": "..."}`;
}

export async function generateCaptions(transcript: string, settings: OrgSettings): Promise<CaptionSet> {
  const key = anthropicApiKey();
  if (!key) throw new StudioApiError('ANTHROPIC_API_KEY is not configured.', 503);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 1200,
      messages: [{ role: 'user', content: captionPrompt(transcript, settings) }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new StudioApiError(`Caption generation failed (Anthropic ${res.status}).`, 502);

  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new StudioApiError('Caption generation returned no captions.', 502);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new StudioApiError('Caption generation returned malformed captions.', 502);
  }

  const pick = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string).trim() : '');
  const captions = { instagram: pick('instagram'), linkedin: pick('linkedin'), tiktok: pick('tiktok') };
  if (!captions.instagram || !captions.linkedin || !captions.tiktok) {
    throw new StudioApiError('Caption generation left out a platform. Try again.', 502);
  }
  return captions;
}
