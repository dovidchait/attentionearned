import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Integration test — verifies that importing the same file twice produces zero duplicates.
// Requires a running Postgres 15 instance and generated fixtures.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_FILE = join(__dirname, '../fixtures/charidy-sample.xlsx');

describe('Import idempotency', () => {
  beforeAll(async () => {
    if (!existsSync(SAMPLE_FILE)) {
      console.warn('Skipping idempotency test — fixtures not generated. Run: npm run generate:fixtures');
    }
  });

  it('importing the same file twice produces zero duplicate donors', async () => {
    if (!existsSync(SAMPLE_FILE)) return;

    let dbInstance: any;
    try {
      const mod = await import('../../src/lib/db.js');
      const client = await mod.pool.connect();
      await client.query('SELECT 1');
      client.release();
      dbInstance = mod.db;
    } catch {
      console.warn('Skipping idempotency test — DB not reachable');
      return;
    }

    const { runImport } = await import('../../src/ingestion/importer.js');
    const { orgs, campaigns, donors } = await import('../../src/schema/index.js');
    const { eq } = await import('drizzle-orm');

    // Ensure test org and campaign exist
    const [testOrg] = await dbInstance
      .insert(orgs)
      .values({ slug: 'idempotency-test-org', name: 'Idempotency Test Org', status: 'live', sendEnabled: false })
      .onConflictDoUpdate({ target: orgs.slug, set: { updatedAt: new Date() } })
      .returning();

    await dbInstance
      .insert(campaigns)
      .values({
        orgId: testOrg.id,
        platform: 'charidy',
        externalId: 'idempotency-campaign',
        name: 'Idempotency Test Campaign',
        sendEnabled: false,
      })
      .onConflictDoNothing();

    const importOpts = {
      orgSlug: 'idempotency-test-org',
      campaignExternalId: 'idempotency-campaign',
      adapter: 'charidy' as const,
      dryRun: false,
    };

    // First import
    const summary1 = await runImport(SAMPLE_FILE, importOpts);
    const donorCount1 = (await dbInstance.select().from(donors).where(eq(donors.orgId, testOrg.id))).length;

    // Second import
    const summary2 = await runImport(SAMPLE_FILE, importOpts);
    const donorCount2 = (await dbInstance.select().from(donors).where(eq(donors.orgId, testOrg.id))).length;

    // Zero new donors on second import
    expect(summary2.donorsCreated).toBe(0);
    expect(donorCount2).toBe(donorCount1);

    // Zero new gifts on second import
    expect(summary2.giftsCreated).toBe(0);
    expect(summary2.giftsSkipped).toBeGreaterThan(0);
  });
});
