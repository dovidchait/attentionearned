import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { donors, type Donor, type NewDonor } from '../schema/index.js';

export async function findDonorByDedupeKey(orgId: string, dedupeKey: string): Promise<Donor | undefined> {
  const rows = await db
    .select()
    .from(donors)
    .where(and(eq(donors.orgId, orgId), eq(donors.dedupeKey, dedupeKey)))
    .limit(1);
  return rows[0];
}

export async function getAllDonorsByOrg(orgId: string): Promise<Donor[]> {
  return db.select().from(donors).where(eq(donors.orgId, orgId));
}

export async function createDonor(data: NewDonor): Promise<Donor> {
  const rows = await db.insert(donors).values(data).returning();
  return rows[0]!;
}

export async function updateDonor(id: string, data: Partial<NewDonor>): Promise<Donor> {
  const rows = await db
    .update(donors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(donors.id, id))
    .returning();
  return rows[0]!;
}
