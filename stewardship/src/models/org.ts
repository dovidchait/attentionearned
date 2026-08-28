import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { orgs, type NewOrg, type Org } from '../schema/index.js';

export async function findOrgBySlug(slug: string): Promise<Org | undefined> {
  const rows = await db.select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  return rows[0];
}

export async function createOrg(data: NewOrg): Promise<Org> {
  const rows = await db.insert(orgs).values(data).returning();
  return rows[0]!;
}

export async function upsertOrg(data: NewOrg & { slug: string }): Promise<Org> {
  const rows = await db
    .insert(orgs)
    .values(data)
    .onConflictDoUpdate({
      target: orgs.slug,
      set: {
        name: data.name,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0]!;
}
