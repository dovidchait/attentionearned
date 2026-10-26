import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default: read the shared users.json from fly-service.
// Override with USERS_FILE env var for separate deployments.
const USERS_FILE = process.env.USERS_FILE
  ? resolve(process.env.USERS_FILE)
  : join(__dirname, '../../fly-service/users.json');

let config = { users: [] };
try {
  config = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  console.log(`📋 Loaded ${config.users.length} user(s) from ${USERS_FILE}`);
} catch (e) {
  console.warn(`⚠️  Could not load users.json (${USERS_FILE}): ${e.message}`);
}

export function allUsers() {
  return config.users;
}

export function findUserByEmail(email) {
  if (!email) return null;
  const norm = email.toLowerCase().trim();
  return config.users.find(u => {
    const emails = [u.email, ...(u.emails || [])].filter(Boolean).map(e => e.toLowerCase().trim());
    return emails.includes(norm);
  }) ?? null;
}

/** David's email gets admin access to all client dashboards */
export function isAdmin(email) {
  const adminEmails = (process.env.ADMIN_EMAILS || 'chaitd@outlook.com,david@attentionearned.com')
    .split(',').map(e => e.trim().toLowerCase());
  return adminEmails.includes(email?.toLowerCase());
}

export function apiKeyFor(user) {
  return process.env[user?.apiKeyEnv || 'ZERNIO_API_KEY'];
}

export function accountLabels(user) {
  return Object.fromEntries(
    (user?.accounts || []).map(a => [a.accountId, a.label || `${a.platform} ${a.accountId}`])
  );
}
