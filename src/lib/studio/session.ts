// Resolves who is signed in and which Zernio profile belongs to them.
// Each Clerk user maps to one Zernio profile (externalId = Clerk user id). The profile id
// and the org settings live in Clerk privateMetadata.studio, which the browser never sees.

import type { APIContext, AstroGlobal } from 'astro';
import { clerkClient } from '@clerk/astro/server';
import { readSettings, type OrgSettings } from './rules';
import { createZernioProfile } from './zernio';

type RequestContext = APIContext | AstroGlobal;

export interface StudioContext {
  userId: string;
  profileId: string;
  settings: OrgSettings;
}

interface StoredStudio {
  zernioProfileId?: string;
  settings?: unknown;
}

function storedStudio(privateMetadata: unknown): StoredStudio {
  if (!privateMetadata || typeof privateMetadata !== 'object') return {};
  const studio = (privateMetadata as Record<string, unknown>).studio;
  return studio && typeof studio === 'object' ? (studio as StoredStudio) : {};
}

/** Merges a patch into privateMetadata.studio and leaves every other metadata key alone. */
export async function saveStudioMetadata(
  context: RequestContext,
  userId: string,
  patch: StoredStudio,
): Promise<void> {
  const client = clerkClient(context as APIContext);
  const user = await client.users.getUser(userId);
  const current = (user.privateMetadata ?? {}) as Record<string, unknown>;
  await client.users.updateUserMetadata(userId, {
    privateMetadata: { ...current, studio: { ...storedStudio(current), ...patch } },
  });
}

/**
 * Returns the caller's Studio context, or null when nobody is signed in.
 * The first call for a new user creates their Zernio profile and stores its id.
 */
export async function getStudioContext(context: RequestContext): Promise<StudioContext | null> {
  const { userId } = context.locals.auth();
  if (!userId) return null;

  const user = await context.locals.currentUser();
  const stored = storedStudio(user?.privateMetadata);

  let profileId = stored.zernioProfileId;
  if (!profileId) {
    profileId = await createZernioProfile(userId, 'Studio client');
    await saveStudioMetadata(context, userId, { zernioProfileId: profileId });
  }

  return { userId, profileId, settings: readSettings(stored.settings) };
}
