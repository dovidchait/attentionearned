// ============================================================================
// KEYWORDS: STOP / START / HELP (WhatsApp, email; SMS is answered by Twilio)
// ============================================================================

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REVOKE']);
const START_WORDS = new Set(['START', 'JOIN', 'UNSTOP', 'SUBSCRIBE', 'OPTIN', 'OPT IN']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

/** 'stop' | 'start' | 'help' | null. The whole message has to be the keyword. */
export function keywordOf(text) {
  const word = String(text || '').trim().toUpperCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (STOP_WORDS.has(word)) return 'stop';
  if (START_WORDS.has(word)) return 'start';
  if (HELP_WORDS.has(word)) return 'help';
  return null;
}

// Every outbound message gets the "Attention Earned:" prefix in notify.js / poster.js.
export const KEYWORD_REPLIES = {
  help: 'Send a video or photo with your caption and we post it to your social accounts, then reply with the live links. ' +
    'Add "post to instagram business" (or linkedin, tiktok, youtube, personal) to pick accounts. ' +
    'Videos over 16 MB: send a Dropbox or Google Drive link instead. ' +
    'Help: editors@attentionearned.com or 347-361-0822. Reply STOP to opt out.',
  stop: "You're unsubscribed and won't get more messages from us here. Reply START to resubscribe.",
  start: "You're signed up for updates about your posts (live links, failure notices, reminders). Msg frequency varies. Reply HELP for help, STOP to opt out."
};
