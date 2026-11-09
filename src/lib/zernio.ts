// Shared Zernio API types

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
  profileUrl?: string;
}

export interface ZernioProfile {
  _id: string;
  externalId: string;
  name?: string;
}

// Returns base Zernio API URL and auth headers.
// Throws if ZERNIO_API_KEY is not configured.
export function zernioClient(env: ImportMetaEnv) {
  const apiKey = env.ZERNIO_API_KEY?.trim();
  if (!apiKey) throw new Error('ZERNIO_API_KEY not configured');
  const base = env.ZERNIO_API_BASE ?? 'https://zernio.com/api/v1';
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  return { base, headers };
}
