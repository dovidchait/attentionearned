function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalBool(name: string, defaultValue: boolean): boolean {
  const val = process.env[name];
  if (val === undefined) return defaultValue;
  return val === 'true' || val === '1';
}

export const env = {
  DATABASE_URL: require('DATABASE_URL'),
  // Safety switches — all default off/true so no sends happen without explicit opt-in
  DRY_RUN: optionalBool('DRY_RUN', true),
  SEND_ENABLED: optionalBool('SEND_ENABLED', false),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),
  // Object storage
  S3_BUCKET: optional('S3_BUCKET', ''),
  S3_ENDPOINT: optional('S3_ENDPOINT', ''),
  S3_REGION: optional('S3_REGION', 'us-east-1'),
  S3_ACCESS_KEY_ID: optional('S3_ACCESS_KEY_ID', ''),
  S3_SECRET_ACCESS_KEY: optional('S3_SECRET_ACCESS_KEY', ''),
  // Zernio
  ZERNIO_API_KEY: optional('ZERNIO_API_KEY', ''),
  ZERNIO_BASE_URL: optional('ZERNIO_BASE_URL', 'https://api.zernio.io'),
  // EmailIt
  EMAILIT_API_KEY: optional('EMAILIT_API_KEY', ''),
  EMAILIT_BASE_URL: optional('EMAILIT_BASE_URL', 'https://api.emailit.com'),
  // Local media storage root (used when no cloud storage backend is configured)
  MEDIA_DIR: optional('MEDIA_DIR', './media'),
} as const;

export type Env = typeof env;
