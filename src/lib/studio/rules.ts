// Pure rules shared by the Studio routes, the Studio pages and the tests.
// Keep this file free of imports and env access so `node --test` can load it directly.

export const STUDIO_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook', 'twitter'] as const;

export type StudioPlatform = (typeof STUDIO_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<StudioPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  twitter: 'X (Twitter)',
};

export function isStudioPlatform(value: unknown): value is StudioPlatform {
  return typeof value === 'string' && (STUDIO_PLATFORMS as readonly string[]).includes(value);
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ─── Captions ────────────────────────────────────────────────────────────────

// The wizard writes three captions. Every platform reads exactly one of them.
export type CaptionKey = 'instagram' | 'tiktok' | 'linkedin';

const CAPTION_FOR: Record<StudioPlatform, CaptionKey> = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  facebook: 'instagram',
  youtube: 'instagram',
  twitter: 'linkedin',
};

export function captionKeyFor(platform: StudioPlatform): CaptionKey {
  return CAPTION_FOR[platform];
}

export const MAX_CAPTION_CHARS = 2200;

// ─── OAuth connect ───────────────────────────────────────────────────────────

// Platforms that need one more Zernio step after the connect callback.
export const SELECT_STEP_FOR: Partial<Record<StudioPlatform, string>> = {
  facebook: 'select_page',
  linkedin: 'select_profile',
};

// ─── Media uploads ───────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type MediaKind = 'video' | 'image' | 'gif';

export function mediaKindFor(contentType: string): MediaKind | null {
  if (VIDEO_TYPES.includes(contentType)) return 'video';
  if (contentType === 'image/gif') return 'gif';
  if (IMAGE_TYPES.includes(contentType)) return 'image';
  return null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120);
  return cleaned || 'upload';
}

export function validatePresign(
  input: unknown,
): Result<{ filename: string; contentType: string; size: number; kind: MediaKind }> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Request body must be JSON.' };
  const { filename, contentType, size } = input as Record<string, unknown>;
  if (typeof filename !== 'string' || !filename.trim()) return { ok: false, error: 'filename is required.' };
  if (typeof contentType !== 'string') return { ok: false, error: 'contentType is required.' };
  const kind = mediaKindFor(contentType);
  if (!kind) return { ok: false, error: `Unsupported file type: ${contentType || 'unknown'}.` };
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return { ok: false, error: 'size must be a positive whole number of bytes.' };
  }
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: 'Files over 1 GB are not supported.' };
  return { ok: true, value: { filename: safeFilename(filename), contentType, size, kind } };
}

// ─── Org settings ────────────────────────────────────────────────────────────

export interface OrgSettings {
  orgName: string;
  voiceTone: string;
  currentCampaign: string;
  campaignDay: number | null;
}

export const EMPTY_SETTINGS: OrgSettings = {
  orgName: '',
  voiceTone: '',
  currentCampaign: '',
  campaignDay: null,
};

function textField(raw: Record<string, unknown>, key: string, max: number): Result<string> {
  const value = raw[key] ?? '';
  if (typeof value !== 'string') return { ok: false, error: `${key} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false, error: `${key} must be ${max} characters or fewer.` };
  return { ok: true, value: trimmed };
}

export function validateSettings(input: unknown): Result<OrgSettings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Settings must be an object.' };
  }
  const raw = input as Record<string, unknown>;

  const orgName = textField(raw, 'orgName', 100);
  if (!orgName.ok) return orgName;
  const voiceTone = textField(raw, 'voiceTone', 1000);
  if (!voiceTone.ok) return voiceTone;
  const currentCampaign = textField(raw, 'currentCampaign', 150);
  if (!currentCampaign.ok) return currentCampaign;

  let campaignDay: number | null = null;
  const dayRaw = raw.campaignDay;
  if (dayRaw !== undefined && dayRaw !== null && dayRaw !== '') {
    const day = typeof dayRaw === 'number' ? dayRaw : Number(dayRaw);
    if (!Number.isInteger(day) || day < 1 || day > 30) {
      return { ok: false, error: 'Campaign day must be a whole number from 1 to 30.' };
    }
    campaignDay = day;
  }

  return {
    ok: true,
    value: {
      orgName: orgName.value,
      voiceTone: voiceTone.value,
      currentCampaign: currentCampaign.value,
      campaignDay,
    },
  };
}

/** Stored settings come back through Clerk metadata; anything unreadable falls back to empty. */
export function readSettings(raw: unknown): OrgSettings {
  const result = validateSettings(raw);
  return result.ok ? result.value : { ...EMPTY_SETTINGS };
}

// ─── Posts ───────────────────────────────────────────────────────────────────

export const ID_PATTERN = /^[A-Za-z0-9_-]{4,80}$/;
export const MAX_TARGETS = 30;

export interface TargetInput {
  accountId: string;
  caption: string;
}

export function validateTargets(input: unknown): Result<TargetInput[]> {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Choose at least one account.' };
  if (input.length > MAX_TARGETS) return { ok: false, error: `Post to at most ${MAX_TARGETS} accounts at once.` };
  const targets: TargetInput[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Each target needs an accountId and a caption.' };
    const { accountId, caption } = item as Record<string, unknown>;
    if (typeof accountId !== 'string' || !ID_PATTERN.test(accountId)) return { ok: false, error: 'Invalid account id.' };
    if (typeof caption !== 'string' || !caption.trim()) {
      return { ok: false, error: 'Every selected account needs a caption.' };
    }
    if (caption.trim().length > MAX_CAPTION_CHARS) {
      return { ok: false, error: `Captions must be ${MAX_CAPTION_CHARS} characters or fewer.` };
    }
    targets.push({ accountId, caption: caption.trim() });
  }
  return { ok: true, value: targets };
}

/** One Zernio post per distinct caption, so accounts that share a caption post together. */
export function groupByCaption<T extends { caption: string }>(items: T[]): Array<{ caption: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.caption);
    if (list) list.push(item);
    else groups.set(item.caption, [item]);
  }
  return [...groups.entries()].map(([caption, list]) => ({ caption, items: list }));
}

export interface MediaRef {
  url: string;
  type: MediaKind;
}

export function validateMedia(input: unknown): Result<MediaRef> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Add a video or image before posting.' };
  const { url, type } = input as Record<string, unknown>;
  if (typeof url !== 'string' || url.length > 2048) return { ok: false, error: 'The media URL is missing or too long.' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'The media URL is not valid.' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'The media URL must use https.' };
  if (type !== 'video' && type !== 'image' && type !== 'gif') {
    return { ok: false, error: 'Media type must be video, image or gif.' };
  }
  return { ok: true, value: { url: parsed.toString(), type } };
}

export const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export type Schedule = { publishNow: true } | { publishNow: false; scheduledFor: string; timezone: string };

export function validateSchedule(
  input: { publishNow?: unknown; scheduledFor?: unknown; timezone?: unknown },
  now: number = Date.now(),
): Result<Schedule> {
  if (input.publishNow === true) return { ok: true, value: { publishNow: true } };
  if (typeof input.scheduledFor !== 'string') {
    return { ok: false, error: 'Pick a date and time, or choose Post now.' };
  }
  const when = Date.parse(input.scheduledFor);
  if (Number.isNaN(when)) return { ok: false, error: 'The scheduled time is not valid.' };
  if (when - now < MIN_LEAD_MS) return { ok: false, error: 'Schedule at least a minute from now, or choose Post now.' };
  if (when - now > MAX_LEAD_MS) return { ok: false, error: 'Schedule within the next year.' };
  const timezone =
    typeof input.timezone === 'string' && isValidTimeZone(input.timezone) ? input.timezone : 'UTC';
  return { ok: true, value: { publishNow: false, scheduledFor: new Date(when).toISOString(), timezone } };
}

export function isSubmissionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/**
 * A post belongs to the caller when Zernio says it is on their profile, or, if the
 * response carries no profile id, when every platform entry points at one of their accounts.
 * Anything else (including a post with no platforms) is refused.
 */
export function postBelongsToProfile(
  post: { profileId?: unknown; platforms?: unknown },
  profileId: string,
  accountIds: Set<string>,
): boolean {
  if (typeof post.profileId === 'string' && post.profileId.length > 0) return post.profileId === profileId;
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  if (platforms.length === 0) return false;
  return platforms.every((entry) => {
    const accountId = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).accountId : undefined;
    return typeof accountId === 'string' && accountIds.has(accountId);
  });
}

export interface CalendarPost {
  id: string;
  content: string;
  status: string;
  when: string | null;
  upcoming: boolean;
  editable: boolean;
  platforms: string[];
}

const UPCOMING_STATUSES = new Set(['draft', 'scheduled', 'queued', 'pending', 'processing', 'publishing']);
const IN_FLIGHT_STATUSES = new Set(['processing', 'publishing']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zernio's response shape is not typed here
export function toCalendarPost(raw: any): CalendarPost | null {
  const id = raw?._id ?? raw?.id;
  if (typeof id !== 'string' || !id) return null;
  const status = typeof raw.status === 'string' ? raw.status.toLowerCase() : 'unknown';
  const upcoming = UPCOMING_STATUSES.has(status);
  const candidate = upcoming
    ? raw.scheduledFor ?? raw.createdAt
    : raw.publishedAt ?? raw.scheduledFor ?? raw.createdAt;
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.map((p: { platform?: unknown }) => String(p?.platform ?? '')).filter(Boolean)
    : [];
  return {
    id,
    content: typeof raw.content === 'string' ? raw.content : '',
    status,
    when: typeof candidate === 'string' ? candidate : null,
    upcoming,
    editable: upcoming && !IN_FLIGHT_STATUSES.has(status),
    platforms,
  };
}

// ─── Redirects ───────────────────────────────────────────────────────────────

/** Only same-site Studio paths may be used as a post-login destination. */
export function safeStudioPath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^\/studio(\/[A-Za-z0-9/_-]*)?$/.test(value) ? value : fallback;
}
