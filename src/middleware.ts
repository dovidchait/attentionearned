import { clerkMiddleware } from '@clerk/astro/server';

function isStudioProtected(url: URL): boolean {
  return (
    url.pathname.startsWith('/studio/dashboard') ||
    url.pathname.startsWith('/studio/create') ||
    url.pathname.startsWith('/studio/connect') ||
    url.pathname.startsWith('/api/studio')
  );
}

export const onRequest = clerkMiddleware(async (auth, context, next) => {
  if (isStudioProtected(new URL(context.request.url))) {
    const { userId, sessionClaims } = await auth();

    if (!userId) {
      return context.redirect('/studio/login');
    }

    // Provision Zernio profile on first login if not yet stored in Clerk metadata
    const meta = (sessionClaims?.publicMetadata ?? {}) as { zernio_profile_id?: string };
    if (!meta.zernio_profile_id) {
      const origin = new URL(context.request.url).origin;
      await fetch(`${origin}/api/studio/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: context.request.headers.get('cookie') ?? '',
        },
      }).catch(() => {
        // Non-fatal: profile will be provisioned on next request
      });
    }
  }

  return next();
});
