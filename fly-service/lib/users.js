import fs from 'fs';

// ============================================================================
// USERS (multi-user)
// users.json maps each person's phone / WhatsApp / email to their Zernio
// accounts. It holds IDs only, never keys: a user's Zernio key comes from the
// env var named in `apiKeyEnv` (default ZERNIO_API_KEY).
// ============================================================================

const USERS_FILE = process.env.USERS_FILE || new URL('../users.json', import.meta.url);

let usersConfig = { users: [] };
try {
  usersConfig = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  console.log(`📋 Loaded ${usersConfig.users.length} user(s) from users.json`);
} catch (error) {
  console.warn(`⚠️  Could not load users.json: ${error.message}`);
}

export function allUsers() {
  return usersConfig.users;
}

export function normalizePhone(value) {
  return (value || '').replace(/^whatsapp:/, '').replace(/[^\d+]/g, '');
}

function emailsOf(user) {
  return [user.email, ...(user.emails || [])].filter(Boolean).map(e => e.toLowerCase().trim());
}

/** Find the user who sent a message on a given channel. */
export function findUser(channelName, sender) {
  if (!sender) return null;
  if (channelName === 'email') {
    const address = extractEmail(sender);
    return usersConfig.users.find(u => emailsOf(u).includes(address)) || null;
  }
  const number = normalizePhone(sender);
  if (channelName === 'whatsapp') {
    return usersConfig.users.find(u => normalizePhone(u.whatsapp) === number || normalizePhone(u.phone) === number) || null;
  }
  return usersConfig.users.find(u => normalizePhone(u.phone) === number) || null;
}

/** "David <chaitd@outlook.com>" -> "chaitd@outlook.com" */
export function extractEmail(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).toLowerCase().trim();
}

export function apiKeyFor(user) {
  return process.env[user?.apiKeyEnv || 'ZERNIO_API_KEY'];
}

/** accountId -> human label, e.g. "IG @dovid_chait" */
export function accountLabels(user) {
  return Object.fromEntries((user?.accounts || []).map(a => [a.accountId, a.label || `${a.platform} ${a.accountId}`]));
}
