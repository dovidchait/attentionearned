import { defineMiddleware } from 'astro:middleware';

// ── Auth middleware ────────────────────────────────────────────────────────────
// Protect /studio/* pages. Currently a passthrough stub — activate by:
//   1. npm install @clerk/astro
//   2. Add clerk() to astro.config.mjs integrations
//   3. Set CLERK_SECRET_KEY and PUBLIC_CLERK_PUBLISHABLE_KEY env vars
//   4. Replace this middleware body with Clerk's clerkMiddleware() helper
//
// Until Clerk is configured, /studio routes are accessible without auth.
// ─────────────────────────────────────────────────────────────────────────────

export const onRequest = defineMiddleware(async (_context, next) => {
  return next();
});
