// Runtime configuration for the Studio. Every getter returns null (or a default) when the
// variable is unset, so routes can answer "not configured" instead of throwing.

function read(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function clerkPublishableKey(): string | null {
  return read(import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export function clerkConfigured(): boolean {
  return Boolean(clerkPublishableKey() && read(import.meta.env.CLERK_SECRET_KEY));
}

/** Clerk's frontend API host, decoded from the publishable key (pk_<env>_<base64 of "host$">). */
export function clerkFrontendApi(): string | null {
  const encoded = clerkPublishableKey()?.split('_')[2];
  if (!encoded) return null;
  try {
    return atob(encoded).replace(/\$$/, '') || null;
  } catch {
    return null;
  }
}

// The clerk-js build that @clerk/astro 4.1.30 loads by default. Keep it pinned to the same version.
const CLERK_JS_VERSION = '5.57.1';

export function clerkJsUrl(): string | null {
  const host = clerkFrontendApi();
  return host ? `https://${host}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js` : null;
}

export function zernioApiKey(): string | null {
  return read(import.meta.env.ZERNIO_API_KEY);
}

export function zernioBaseUrl(): string {
  return (read(import.meta.env.ZERNIO_BASE_URL) ?? 'https://zernio.com/api/v1').replace(/\/$/, '');
}

export function anthropicApiKey(): string | null {
  return read(import.meta.env.ANTHROPIC_API_KEY);
}

export function ideogramApiKey(): string | null {
  return read(import.meta.env.IDEOGRAM_API_KEY);
}
