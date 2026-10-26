import fetch from 'node-fetch';

const BASE = (process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1').replace(/\/$/, '');

export class ZernioError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request(method, path, { apiKey, body, query } = {}) {
  if (!apiKey) throw new ZernioError('Zernio API key not configured', { status: 500 });
  const url = new URL(`${BASE}${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  };

  const res = await fetch(url.toString(), opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }

  if (!res.ok) {
    throw new ZernioError(
      `Zernio ${res.status} ${method} ${path}: ${json?.error || json?.message || text.slice(0, 200)}`,
      { status: res.status, code: json?.code, body: json }
    );
  }
  return json;
}

// ─── Posts ──────────────────────────────────────────────────────────────────

export function listPosts(apiKey, { profileId, status, limit = 50, page = 1 } = {}) {
  return request('GET', '/posts', { apiKey, query: { profileId, status, limit, page } });
}

export function getPost(postId, apiKey) {
  return request('GET', `/posts/${encodeURIComponent(postId)}`, { apiKey });
}

export function createPost(postData, apiKey) {
  return request('POST', '/posts', { apiKey, body: postData });
}

export function updatePost(postId, updates, apiKey) {
  return request('PUT', `/posts/${encodeURIComponent(postId)}`, { apiKey, body: updates });
}

export function deletePost(postId, apiKey) {
  return request('DELETE', `/posts/${encodeURIComponent(postId)}`, { apiKey });
}

export function publishPostNow(postId, apiKey) {
  return request('POST', `/posts/${encodeURIComponent(postId)}/publish`, { apiKey });
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export function listAccounts(apiKey, { profileId } = {}) {
  return request('GET', '/accounts', { apiKey, query: { profileId } });
}

export function getAccount(accountId, apiKey) {
  return request('GET', `/accounts/${encodeURIComponent(accountId)}`, { apiKey });
}

/** Returns the OAuth redirect URL for connecting a platform. */
export function getConnectUrl(platform, profileId, redirectUrl, apiKey) {
  // Zernio connect: GET /connect/:platform → redirects to OAuth; we generate the URL ourselves.
  const url = new URL(`${BASE}/connect/${encodeURIComponent(platform)}`);
  url.searchParams.set('profileId', profileId);
  url.searchParams.set('redirect_url', redirectUrl);
  // Return the URL string; the browser follows it (no API key in the URL itself).
  return url.toString();
}

export async function completeConnectStep(platform, step, body, apiKey) {
  return request('POST', `/connect/${encodeURIComponent(platform)}/${encodeURIComponent(step)}`, {
    apiKey, body,
  });
}

// ─── Media ──────────────────────────────────────────────────────────────────

export function listMedia(apiKey, { profileId, limit = 30, page = 1 } = {}) {
  return request('GET', '/media', { apiKey, query: { profileId, limit, page } });
}

export async function presignUpload(filename, contentType, size, apiKey) {
  return request('POST', '/media/presign', {
    apiKey,
    body: { filename, contentType, size },
  });
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export function getPostAnalytics(postId, apiKey) {
  return request('GET', `/posts/${encodeURIComponent(postId)}/analytics`, { apiKey });
}

export function getAccountAnalytics(accountId, apiKey, { period = '30d' } = {}) {
  return request('GET', `/accounts/${encodeURIComponent(accountId)}/analytics`, {
    apiKey, query: { period },
  });
}

// ─── Profiles ───────────────────────────────────────────────────────────────

export function getProfile(profileId, apiKey) {
  return request('GET', `/profiles/${encodeURIComponent(profileId)}`, { apiKey });
}
