import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { campaigns, type Campaign, type NewCampaign } from '../schema/index.js';

export async function findCampaignByExternalId(orgId: string, externalId: string): Promise<Campaign | undefined> {
  const rows = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.orgId, orgId), eq(campaigns.externalId, externalId)))
    .limit(1);
  return rows[0];
}

export async function createCampaign(data: NewCampaign): Promise<Campaign> {
  const rows = await db.insert(campaigns).values(data).returning();
  return rows[0]!;
}

export async function upsertCampaign(data: NewCampaign & { orgId: string; externalId: string }): Promise<Campaign> {
  const rows = await db
    .insert(campaigns)
    .values(data)
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return rows[0];
  const existing = await findCampaignByExternalId(data.orgId, data.externalId);
  return existing!;
}
