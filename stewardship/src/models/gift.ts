import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { gifts, type Gift, type NewGift } from '../schema/index.js';

export async function findGiftByExternalId(orgId: string, platform: string, externalId: string): Promise<Gift | undefined> {
  const rows = await db
    .select()
    .from(gifts)
    .where(and(eq(gifts.orgId, orgId), eq(gifts.platform, platform), eq(gifts.externalId, externalId)))
    .limit(1);
  return rows[0];
}

export async function getExistingGiftExternalIds(orgId: string, platform: string): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: gifts.externalId })
    .from(gifts)
    .where(and(eq(gifts.orgId, orgId), eq(gifts.platform, platform)));
  return new Set(rows.map(r => r.externalId));
}

export async function createGift(data: NewGift): Promise<Gift> {
  const rows = await db.insert(gifts).values(data).returning();
  return rows[0]!;
}
