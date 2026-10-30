import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server';

const isStudioRoute = createRouteMatcher(['/studio/create', '/studio/dashboard', '/studio/connect', '/studio/settings']);

export const onRequest = clerkMiddleware((auth, context) => {
  if (isStudioRoute(context.request)) {
    auth.protect({
      unauthenticatedUrl: new URL('/studio/login', context.request.url).toString(),
    });
  }
});
