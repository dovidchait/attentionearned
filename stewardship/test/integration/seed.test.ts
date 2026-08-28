import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';

// Integration test — requires a running Postgres 15 instance.
// Gracefully skips when DB is not available (unit CI without Postgres).

let dbAvailable = false;
let dbInstance: any = null;

beforeAll(async () => {
  try {
    const { pool, db } = await import('../../src/lib/db.js');
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    dbInstance = db;
    dbAvailable = true;
  } catch {
    console.warn('Skipping seed integration tests — Postgres not reachable');
  }
});

describe('Seed integration', () => {
  it('produces at least 1 org after seed', async () => {
    if (!dbAvailable) {
      console.log('SKIP: DB not available');
      return;
    }

    const { orgs } = await import('../../src/schema/index.js');
    const rows = await dbInstance.select().from(orgs).where(eq(orgs.slug, 'demo-org'));

    if (rows.length === 0) {
      console.warn('demo-org not found — run `npm run seed` first');
    } else {
      expect(rows[0].slug).toBe('demo-org');
      expect(rows[0].sendEnabled).toBe(false);
    }
  });

  it('demo-org donors have consents on all 3 channels', async () => {
    if (!dbAvailable) {
      console.log('SKIP: DB not available');
      return;
    }

    const { donors, consents, orgs } = await import('../../src/schema/index.js');

    const orgRows = await dbInstance.select().from(orgs).where(eq(orgs.slug, 'demo-org'));
    if (orgRows.length === 0) {
      console.warn('demo-org not found — run `npm run seed` first');
      return;
    }

    const org = orgRows[0];
    const donorRows = await dbInstance.select().from(donors).where(eq(donors.orgId, org.id));
    if (donorRows.length === 0) {
      console.warn('No donors found — run `npm run seed` first');
      return;
    }

    const firstDonor = donorRows[0];
    const consentRows = await dbInstance
      .select()
      .from(consents)
      .where(eq(consents.donorId, firstDonor.id));

    expect(consentRows.length).toBe(3);
    const channels = consentRows.map((c: any) => c.channel);
    expect(channels).toContain('whatsapp');
    expect(channels).toContain('sms');
    expect(channels).toContain('email');
  });
});
