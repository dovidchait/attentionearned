// ============================================================================
// COMMAND PARSER + TARGET SELECTION
// Same commands as before, on every channel (SMS, WhatsApp, email):
//   "Post to instagram, linkedin"   "Post to all"   "Add to queue"
//   "Schedule: 2026-11-02 10:00 EST"   "Post at tomorrow 9am"
// New: narrow to one side with "personal" or "business" (aka "ae"):
//   "Post to instagram business" -> only IG @attentionearned
// ============================================================================

const PLATFORM_KEYWORDS = {
  instagram: 'instagram', ig: 'instagram', insta: 'instagram',
  facebook: 'facebook', fb: 'facebook',
  linkedin: 'linkedin',
  tiktok: 'tiktok',
  youtube: 'youtube', yt: 'youtube', shorts: 'youtube',
  twitter: 'twitter', x: 'twitter',
  threads: 'threads', bluesky: 'bluesky', pinterest: 'pinterest', reddit: 'reddit'
};

const GROUP_KEYWORDS = {
  personal: 'personal',
  business: 'business', biz: 'business', company: 'business', ae: 'business', attentionearned: 'business'
};

const TZ_ABBREVIATIONS = {
  EST: 'America/New_York', EDT: 'America/New_York', ET: 'America/New_York',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles', PT: 'America/Los_Angeles',
  CST: 'America/Chicago', CDT: 'America/Chicago', CT: 'America/Chicago',
  MST: 'America/Denver', MDT: 'America/Denver', MT: 'America/Denver',
  UTC: 'UTC', GMT: 'UTC'
};

const COMMAND_PHRASE = /(?:post to|add to queue|post now|publish now|schedule:|post at)[^\n]*/gi;

export function parseCommand(subject = '', text = '', defaultTimezone = 'America/New_York') {
  const content = `${subject}\n${text}`;

  // --- targets ---
  const platforms = new Set();
  const groups = new Set();
  let postToAll = false;
  const targetLine = content.match(/post to\s+([^\n]*)/i)?.[1]?.toLowerCase() || '';
  if (/^\s*all\b/.test(targetLine)) postToAll = true;
  for (const word of targetLine.split(/[^a-z0-9_]+/).filter(Boolean)) {
    if (PLATFORM_KEYWORDS[word]) platforms.add(PLATFORM_KEYWORDS[word]);
    if (GROUP_KEYWORDS[word]) groups.add(GROUP_KEYWORDS[word]);
  }

  // --- publishing mode ---
  let publishingMode = 'now';
  let scheduledFor = null;
  let timezone = defaultTimezone;

  if (/add to queue/i.test(content)) {
    publishingMode = 'queue';
  } else if (/post now|publish now/i.test(content)) {
    publishingMode = 'now';
  } else if (/schedule:|post at/i.test(content)) {
    const dateString = content.match(/(?:schedule:|post at)\s*([^\n]+)/i)?.[1]?.trim() || '';

    const tzMatch = dateString.match(/\b([A-Z]{2,4})\s*$/i);
    if (tzMatch && TZ_ABBREVIATIONS[tzMatch[1].toUpperCase()]) timezone = TZ_ABBREVIATIONS[tzMatch[1].toUpperCase()];

    const isoMatch = dateString.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})/);
    const relativeMatch = dateString.match(/\b(tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);

    if (isoMatch) {
      scheduledFor = `${isoMatch[1]}T${isoMatch[2].padStart(2, '0')}:${isoMatch[3]}`;
    } else if (relativeMatch) {
      const [, when, hour, minute = '00', ampm] = relativeMatch;
      let hours = parseInt(hour, 10) % 12;
      if (ampm.toLowerCase() === 'pm') hours += 12;
      const day = localDate(timezone, when.toLowerCase() === 'tomorrow' ? 1 : 0);
      scheduledFor = `${day}T${String(hours).padStart(2, '0')}:${minute}`;
    }
    // Wall-clock time, read by Zernio in `timezone`
    if (scheduledFor) publishingMode = 'schedule';
  }

  return { platforms: [...platforms], groups: [...groups], postToAll, publishingMode, scheduledFor, timezone };
}

/** Remove command lines from the caption. */
export function stripCommands(text = '') {
  return text.replace(COMMAND_PHRASE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** YYYY-MM-DD in a timezone, offset by N days. */
function localDate(timeZone, addDays = 0) {
  const d = new Date(Date.now() + addDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Pick the user's accounts for this post.
 * Returns { targets: [{account, platformSpecificData}], skipped: [{label, reason}] }
 *
 * - No platform named (or "post to all"): every account with default !== false.
 * - Platforms named: every account on those platforms (both IGs for "instagram").
 * - "personal" / "business" narrows to accounts in that group.
 * - Accounts that can't take this post are skipped with a reason, so the reply
 *   can say so instead of failing silently.
 */
export function selectTargets(user, command, { caption, mediaTypes }) {
  const accounts = user?.accounts || [];
  const explicit = !command.postToAll && command.platforms.length > 0;

  let chosen = explicit
    ? accounts.filter(a => command.platforms.includes(a.platform))
    : accounts.filter(a => a.default !== false);
  if (command.groups.length > 0) chosen = chosen.filter(a => command.groups.includes(a.group));

  const skipped = [];
  if (explicit) {
    for (const platform of command.platforms) {
      if (!accounts.some(a => a.platform === platform)) skipped.push({ label: platform, reason: 'no account connected for it' });
    }
  }

  const hasVideo = mediaTypes.includes('video');
  const hasMedia = mediaTypes.length > 0;
  const targets = [];

  for (const account of chosen) {
    const label = account.label || account.platform;
    if (account.disabled) { skipped.push({ label, reason: account.disabled }); continue; }
    if (['instagram', 'tiktok', 'pinterest'].includes(account.platform) && !hasMedia) {
      skipped.push({ label, reason: 'needs a photo or video' }); continue;
    }
    if (account.platform === 'youtube' && !hasVideo) {
      skipped.push({ label, reason: 'needs a video' }); continue;
    }
    targets.push({ account, platformSpecificData: platformDefaults(account, caption) });
  }
  return { targets, skipped };
}

/** Required per-platform fields, with the account's own overrides on top. */
function platformDefaults(account, caption) {
  const firstLine = (caption || '').split('\n').find(l => l.trim())?.trim() || 'New video';
  let data = {};
  if (account.platform === 'youtube') {
    data = { title: firstLine.slice(0, 100), visibility: 'public', madeForKids: false };
  } else if (account.platform === 'tiktok') {
    data = {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      allow_comment: true,
      allow_duet: false,
      allow_stitch: false,
      express_consent_given: true,
      content_preview_confirmed: true
    };
  }
  return { ...data, ...(account.platformSpecificData || {}) };
}
