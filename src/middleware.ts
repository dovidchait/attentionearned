import { clerkMiddleware } from '@clerk/astro/server';

const PROTECTED = [
  '/studio/dashboard',
  '/studio/create',
  '/studio/connect',
  '/studio/settings',
  '/studio/oauth',
];

export const onRequest = clerkMiddleware((auth, context, next) => {
  const url = new URL(context.request.url);
  const isProtected = PROTECTED.some((prefix) => url.pathname.startsWith(prefix));

  if (isProtected) {
    const { userId } = auth();
    if (!userId) {
      return context.redirect(`/studio/login?redirect_url=${encodeURIComponent(url.pathname)}`);
    }
  }

  return next();
});
