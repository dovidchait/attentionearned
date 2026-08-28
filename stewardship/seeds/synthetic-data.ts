import { faker } from '@faker-js/faker';
import { env } from '../src/lib/env.js';
import { db, pool } from '../src/lib/db.js';
import {
  orgs, campaigns, donors, gifts, consents, designations, yomTovDates,
} from '../src/schema/index.js';
import { eq, and } from 'drizzle-orm';

const CHANNELS = ['whatsapp', 'sms', 'email'] as const;

function randomE164(): string {
  const area = faker.string.numeric(3);
  const local = faker.string.numeric(7);
  return `+1${area}${local}`;
}

async function seed() {
  console.log('Seeding synthetic data...');

  // Org
  const [org] = await db
    .insert(orgs)
    .values({
      slug: 'demo-org',
      name: 'Demo Nonprofit',
      status: 'live',
      defaultTimezone: 'America/New_York',
      sendEnabled: false,
    })
    .onConflictDoUpdate({
      target: orgs.slug,
      set: { name: 'Demo Nonprofit', updatedAt: new Date() },
    })
    .returning();

  console.log(`Org: ${org!.slug} (${org!.id})`);

  // Designations
  const [sidurDesig] = await db
    .insert(designations)
    .values({
      orgId: org!.id,
      key: 'siddur',
      unitNounSingular: 'siddur',
      unitNounPlural: 'siddurim',
      unitAmountCents: 1800,
      impactPhrase: 'put a siddur in a child\'s hands',
      sortOrder: 1,
    })
    .onConflictDoNothing()
    .returning();

  // Campaigns
  const campaignData = [
    {
      orgId: org!.id,
      platform: 'charidy' as const,
      externalId: 'demo-campaign-2025',
      name: 'Annual Campaign 2025',
      startsAt: new Date('2025-11-01'),
      endsAt: new Date('2025-11-15'),
      goalCents: 100_000_00,
    },
    {
      orgId: org!.id,
      platform: 'charidy' as const,
      externalId: 'demo-campaign-2024',
      name: 'Annual Campaign 2024',
      startsAt: new Date('2024-11-01'),
      endsAt: new Date('2024-11-15'),
      goalCents: 75_000_00,
    },
  ];

  const insertedCampaigns = await db
    .insert(campaigns)
    .values(campaignData)
    .onConflictDoNothing()
    .returning();

  const allCampaigns = insertedCampaigns.length > 0
    ? insertedCampaigns
    : await db.select().from(campaigns).where(eq(campaigns.orgId, org!.id));

  console.log(`Campaigns: ${allCampaigns.length}`);

  // Donors (50 synthetic)
  const donorValues = Array.from({ length: 50 }, (_, i) => {
    const email = faker.internet.email().toLowerCase();
    return {
      orgId: org!.id,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email,
      phoneE164: randomE164(),
      city: faker.location.city(),
      region: faker.location.state({ abbreviated: true }),
      postalCode: faker.location.zipCode('#####'),
      country: 'US',
      timezone: 'America/New_York',
      ladderStage: 'new' as const,
      dedupeKey: `${org!.id}:email:${email}`,
    };
  });

  const insertedDonors = await db
    .insert(donors)
    .values(donorValues)
    .onConflictDoNothing()
    .returning();

  const allDonors = insertedDonors.length > 0
    ? insertedDonors
    : await db.select().from(donors).where(eq(donors.orgId, org!.id));

  console.log(`Donors: ${allDonors.length}`);

  // Consents (3 per donor)
  const consentValues = allDonors.flatMap(donor =>
    CHANNELS.map(channel => ({
      donorId: donor.id,
      channel,
      state: 'opted_in' as const,
      source: 'synthetic',
    }))
  );

  await db.insert(consents).values(consentValues).onConflictDoNothing();

  console.log(`Consents: ${consentValues.length}`);

  // Gifts (100 distributed across donors/campaigns)
  const giftValues = Array.from({ length: 100 }, (_, i) => {
    const donor = allDonors[i % allDonors.length]!;
    const campaign = allCampaigns[i % allCampaigns.length]!;
    const amountCents = Math.round(faker.number.float({ min: 18, max: 500 }) * 100);
    return {
      orgId: org!.id,
      donorId: donor.id,
      campaignId: campaign.id,
      amountCents,
      currency: 'USD',
      gateway: 'stripe',
      status: 'processed',
      platform: 'charidy',
      externalId: `synthetic-gift-${i}-${Date.now()}`,
      occurredAt: faker.date.recent({ days: 90 }),
    };
  });

  await db.insert(gifts).values(giftValues).onConflictDoNothing();

  console.log(`Gifts: ${giftValues.length}`);

  // Yom Tov dates for the upcoming year (2025-2026)
  const yomTovData: Array<{ gregorianDate: string; name: string; blackoutStartsLocal: string; blackoutEndsLocal: string }> = [
    { gregorianDate: '2025-09-22', name: 'Rosh Hashana', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2025-09-23', name: 'Rosh Hashana Day 2', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2025-10-01', name: 'Yom Kippur', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2025-10-06', name: 'Sukkot', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2025-10-07', name: 'Sukkot Day 2', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2025-10-13', name: 'Shmini Atzeret', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2025-10-14', name: 'Simchat Torah', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-03-13', name: 'Purim', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-04-01', name: 'Pesach', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-04-02', name: 'Pesach Day 2', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-04-07', name: 'Pesach Day 7', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-04-08', name: 'Pesach Day 8', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-05-21', name: 'Shavuot', blackoutStartsLocal: '14:00', blackoutEndsLocal: '22:00' },
    { gregorianDate: '2026-05-22', name: 'Shavuot Day 2', blackoutStartsLocal: '00:00', blackoutEndsLocal: '22:00' },
  ];

  await db.insert(yomTovDates).values(yomTovData).onConflictDoNothing();

  console.log(`Yom Tov dates: ${yomTovData.length}`);
  console.log('Seed complete.');
}

seed().catch(console.error).finally(() => pool.end());
