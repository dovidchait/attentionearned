import crypto from 'crypto';
import fetch from 'node-fetch';

// ============================================================================
// ZERNIO CLIENT (formerly Late.dev)
// Docs: https://docs.zernio.com  ·  Base: https://zernio.com/api/v1  ·  Bearer key
// ============================================================================

const ZERNIO_BASE_URL = (process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1').replace(/\/$/, '');

// Per-platform statuses that mean "not finished yet"
const IN_FLIGHT = new Set(['pending', 'processing', 'uploading', 'scheduled']);

export class ZernioError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 500) }; }
}

function authHeaders(apiKey, extra = {}) {
  if (!apiKey) throw new ZernioError('Zernio API key is not configured (ZERNIO_API_KEY)');
  return { 'Authorization': `Bearer ${apiKey}`, ...extra };
}

/**
 * Upload a file to Zernio storage and return its public URL.
 * POST /media/presign -> { uploadUrl, publicUrl }, then PUT the bytes to uploadUrl.
 */
export async function uploadMedia(buffer, contentType, filename, apiKey) {
  const presign = await fetchWithTimeout(`${ZERNIO_BASE_URL}/media/presign`, {
    method: 'POST',
    headers: authHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename, contentType, size: buffer.length })
  }, 15000);
  const presignData = await readJson(presign);
  if (!presign.ok || !presignData.uploadUrl) {
    throw new ZernioError(`Zernio presign failed: ${presignData.error || presign.status}`, { status: presign.status, body: presignData });
  }

  const put = await fetchWithTimeout(presignData.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buffer
  }, 180000);
  if (!put.ok) throw new ZernioError(`Zernio media upload failed: HTTP ${put.status}`, { status: put.status });

  return { url: presignData.publicUrl, type: getMediaType(contentType) };
}

export function getMediaType(contentType = '') {
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'image/gif') return 'gif';
  return 'image';
}

/**
 * POST /posts. Returns { httpStatus, body }.
 * publishNow posts publish synchronously inside this request, so the timeout is long.
 * The Idempotency-Key makes a retry after a timeout/5xx return the original post
 * instead of posting twice (Zernio keeps keys 24h).
 */
export async function createPost(postData, apiKey, idempotencyKey = crypto.randomUUID()) {
  const timeoutMs = postData.publishNow ? 300000 : 30000;
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetchWithTimeout(`${ZERNIO_BASE_URL}/posts`, {
        method: 'POST',
        headers: authHeaders(apiKey, { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
        body: JSON.stringify(postData)
      }, timeoutMs);
      const body = await readJson(response);

      // First request still being processed: wait and ask again with the same key
      if (response.status === 409 && body.code === 'idempotency_conflict') {
        const wait = Math.min(parseInt(response.headers.get('retry-after') || '10', 10), 60);
        await sleep(wait * 1000);
        continue;
      }
      // Zernio-side hiccup: the same key makes the retry safe
      if (response.status >= 500 && attempt < 4) {
        lastError = new ZernioError(`Zernio ${response.status}: ${body.error || 'server error'}`, { status: response.status, body });
        await sleep(5000 * attempt);
        continue;
      }
      return { httpStatus: response.status, body };
    } catch (error) {
      // Timeout or dropped connection: the post may exist, the same key finds it
      lastError = error;
      if (attempt < 4) await sleep(5000 * attempt);
    }
  }
  throw lastError || new ZernioError('Zernio create post failed');
}

export async function getPost(postId, apiKey) {
  const response = await fetchWithTimeout(`${ZERNIO_BASE_URL}/posts/${encodeURIComponent(postId)}`, {
    headers: authHeaders(apiKey)
  }, 20000);
  const body = await readJson(response);
  if (!response.ok) throw new ZernioError(`Zernio get post failed: ${body.error || response.status}`, { status: response.status, body });
  return body.post || body;
}

/** Poll GET /posts/{id} until no platform is still in flight (or we give up). */
export async function waitForPost(postId, apiKey, { intervalMs = 15000, maxWaitMs = 15 * 60000 } = {}) {
  const started = Date.now();
  let post = await getPost(postId, apiKey);
  while (Date.now() - started < maxWaitMs && isInFlight(post)) {
    await sleep(intervalMs);
    post = await getPost(postId, apiKey);
  }
  return post;
}

export function isInFlight(post) {
  return (post?.platforms || []).some(p => IN_FLIGHT.has(p.status));
}

/**
 * Normalize per-platform results from either a GET /posts response
 * (platformPostUrl, errorMessage, accountId as object) or a webhook payload
 * (publishedUrl, error, accountId as string).
 */
export function platformResults(post, accountLabels = {}) {
  return (post?.platforms || []).map(p => {
    const accountId = typeof p.accountId === 'object' ? p.accountId?._id : p.accountId;
    const username = typeof p.accountId === 'object' ? p.accountId?.username : null;
    return {
      platform: p.platform,
      accountId,
      label: accountLabels[accountId] || (username ? `${p.platform} ${username}` : p.platform),
      status: p.status,
      url: p.platformPostUrl || p.publishedUrl || null,
      error: p.errorMessage || p.error || null
    };
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
