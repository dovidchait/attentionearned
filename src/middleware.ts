import { defineMiddleware } from 'astro:middleware';
import { clerkMiddleware } from '@clerk/astro/server';
import { clerkConfigured } from './lib/studio/env';

// Only /studio app pages and /api/studio routes need a signed-in user. The public marketing
// pages, including the static /studio landing page, never run through Clerk.
const SIGNED_IN_PAGES = ['/studio/dashboard', '/studio/create', '/studio/accounts', '/studio/settings'];
const AUTH_PAGES = ['/studio/login', '/studio/signup'];

const isStudioApi = (path: string) => path.startsWith('/api/studio/');
const isSignedInPage = (path: string) => SIGNED_IN_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
const needsClerk = (path: string) => isStudioApi(path) || isSignedInPage(path) || AUTH_PAGES.includes(path);

const withClerk = clerkMiddleware((auth, context, next) => {
  const path = context.url.pathname;
  if ((isStudioApi(path) || isSignedInPage(path)) && !auth().userId) {
    if (isStudioApi(path)) return Response.json({ error: 'Sign in to use Studio.' }, { status: 401 });
    const back = encodeURIComponent(`${path}${context.url.search}`);
    return context.redirect(`/studio/login?redirect_url=${back}`);
  }
  return next();
});

export const onRequest = defineMiddleware((context, next) => {
  const path = context.url.pathname;
  if (!needsClerk(path)) return next();

  if (!clerkConfigured()) {
    // The auth pages render their own setup notice. Everything else fails closed.
    if (AUTH_PAGES.includes(path)) return next();
    if (isStudioApi(path)) return Response.json({ error: 'Studio sign-in is not configured.' }, { status: 503 });
    return new Response('Studio sign-in is not configured yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return withClerk(context, next);
});
