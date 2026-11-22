// Server-side Zernio client for the Studio. The API key never leaves the server.
// Endpoint shapes follow the production code in fly-service/lib/zernio.js and
// client-dashboard/lib/zernio.js.

import { zernioApiKey, zernioBaseUrl } from './env';
import { StudioApiError } from './http';

export interface StudioAccount {
  id: string;
  platform: string;
  label: string;
  active: boolean;
}

export interface ZernioResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zernio's response shape is not typed here
  data: any;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function zernio(
  method: Method,
  path: string,
  opts: { query?: Record<string, string | number>; body?: unknown; idempotencyKey?: string } = {},
): Promise<ZernioResponse> {
  const key = zernioApiKey();
  if (!key) throw new StudioApiError('Zernio is not configured (ZERNIO_API_KEY).', 503);

  const url = new URL(`${zernioBaseUrl()}${path}`);
  for (const [name, value] of Object.entries(opts.query ?? {})) url.searchParams.set(name, String(value));

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  return { status: res.status, data };
}

function ensureOk(res: ZernioResponse, action: string) {
  if (res.status >= 200 && res.status < 300) return res.data;
  const detail = res.data?.message ?? res.data?.error ?? `status ${res.status}`;
  const status = res.status === 404 ? 404 : res.status === 429 ? 429 : 502;
  throw new StudioApiError(`Zernio could not ${action}: ${String(detail)}`, status);
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function createZernioProfile(externalId: string, name: string): Promise<string> {
  const data = ensureOk(
    await zernio('POST', '/profiles', {
      body: { name, externalId },
      idempotencyKey: `studio-profile-${externalId}`,
    }),
    'create the profile',
  );
  const id =
    data?._id ??
    data?.id ??
    data?.profileId ??
    data?.profile?._id ??
    data?.profile?.id ??
    data?.data?._id ??
    data?.data?.id;
  if (typeof id !== 'string' || !id) throw new StudioApiError('Zernio created a profile but returned no id.', 502);
  return id;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function listZernioAccounts(profileId: string): Promise<StudioAccount[]> {
  const data = ensureOk(await zernio('GET', '/accounts', { query: { profileId } }), 'load accounts');
  const raw: unknown[] = Array.isArray(data) ? data : (data?.accounts ?? data?.data ?? []);
  return raw
    .map((item) => {
      const a = (item ?? {}) as Record<string, unknown>;
      const platform = String(a.platform ?? '');
      const username = typeof a.username === 'string' ? a.username.replace(/^@/, '') : '';
      const name = typeof a.displayName === 'string' ? a.displayName : typeof a.name === 'string' ? a.name : '';
      return {
        id: String(a._id ?? a.id ?? ''),
        platform,
        label: username ? `@${username}` : name || platform,
        active: a.isActive !== false,
      };
    })
    .filter((a) => a.id && a.platform);
}

/**
 * Zernio answers the connect request with a redirect to its OAuth page, or with JSON
 * carrying the URL. The browser follows whichever one we return.
 */
export async function getConnectRedirect(platform: string, profileId: string, redirectUrl: string): Promise<string> {
  const key = zernioApiKey();
  if (!key) throw new StudioApiError('Zernio is not configured (ZERNIO_API_KEY).', 503);

  const url = new URL(`${zernioBaseUrl()}/connect/${encodeURIComponent(platform)}`);
  url.searchParams.set('profileId', profileId);
  url.searchParams.set('redirect_url', redirectUrl);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });

  const location = res.headers.get('location');
  if (location && res.status >= 300 && res.status < 400) return location;

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON; handled below.
  }
  if (!res.ok) {
    throw new StudioApiError(
      `Zernio could not start the ${platform} connection: ${String(data?.message ?? data?.error ?? res.status)}`,
      502,
    );
  }
  const authUrl = data?.authUrl ?? data?.url ?? data?.connectUrl;
  if (typeof authUrl !== 'string' || !authUrl) throw new StudioApiError('Zernio did not return a connect link.', 502);
  return authUrl;
}

export async function completeZernioConnectStep(
  platform: string,
  step: string,
  connectToken: string,
  profileId: string,
): Promise<void> {
  ensureOk(
    await zernio('POST', `/connect/${encodeURIComponent(platform)}/${encodeURIComponent(step)}`, {
      body: { connectToken, profileId },
    }),
    `finish connecting ${platform}`,
  );
}

// ─── Media ───────────────────────────────────────────────────────────────────

export async function presignZernioUpload(
  filename: string,
  contentType: string,
  size: number,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const data = ensureOk(
    await zernio('POST', '/media/presign', { body: { filename, contentType, size } }),
    'prepare the upload',
  );
  if (typeof data?.uploadUrl !== 'string' || typeof data?.publicUrl !== 'string') {
    throw new StudioApiError('Zernio did not return an upload URL.', 502);
  }
  return { uploadUrl: data.uploadUrl, publicUrl: data.publicUrl };
}

/** Re-hosts bytes we fetched elsewhere (for example a generated image) in Zernio storage. */
export async function uploadBytesToZernio(bytes: ArrayBuffer, contentType: string, filename: string): Promise<string> {
  const { uploadUrl, publicUrl } = await presignZernioUpload(filename, contentType, bytes.byteLength);
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok) throw new StudioApiError(`Upload to Zernio storage failed (${put.status}).`, 502);
  return publicUrl;
}

// ─── Posts ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zernio's response shape is not typed here
export async function listZernioPosts(profileId: string, limit = 100): Promise<any[]> {
  const data = ensureOk(await zernio('GET', '/posts', { query: { profileId, limit } }), 'load posts');
  if (Array.isArray(data)) return data;
  return data?.posts ?? data?.data ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zernio's response shape is not typed here
export async function getZernioPost(postId: string): Promise<any | null> {
  const res = await zernio('GET', `/posts/${encodeURIComponent(postId)}`);
  if (res.status === 404) return null;
  const data = ensureOk(res, 'load the post');
  return data?.post ?? data;
}

export function createZernioPost(payload: unknown, idempotencyKey: string): Promise<ZernioResponse> {
  return zernio('POST', '/posts', { body: payload, idempotencyKey });
}

export async function updateZernioPost(postId: string, updates: Record<string, unknown>): Promise<void> {
  ensureOk(await zernio('PUT', `/posts/${encodeURIComponent(postId)}`, { body: updates }), 'update the post');
}

export async function deleteZernioPost(postId: string): Promise<void> {
  ensureOk(await zernio('DELETE', `/posts/${encodeURIComponent(postId)}`), 'delete the post');
}
