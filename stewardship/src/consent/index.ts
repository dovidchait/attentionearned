import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { consents, suppressions, orgs, donors } from '../schema/index.js';
import { env } from '../lib/env.js';
import {
  checkSendability,
  type Channel,
  type SendabilityResult,
} from './sendability.js';

export { checkSendability };
export type { Channel, SendabilityResult };
export type { OrgSnapshot, ConsentSnapshot, SuppressionSnapshot, SendabilityReason } from './sendability.js';

/**
 * DB-backed sendability check. Called inside channel adapters — never bypassed by callers.
 *
 * Implements §5.1 and §5.3: checks global env, org status, org.send_enabled,
 * the donor's consent record for the channel, and any active suppressions.
 *
 * Does NOT handle DRY_RUN — that is a channel-adapter concern (§5.2).
 */
export async function assertSendable(
  donorId: string,
  channel: Channel,
): Promise<SendabilityResult> {
  const [donor] = await db
    .select({ orgId: donors.orgId })
    .from(donors)
    .where(eq(donors.id, donorId));

  if (!donor) throw new Error(`assertSendable: donor not found: ${donorId}`);

  const [org] = await db
    .select({ status: orgs.status, sendEnabled: orgs.sendEnabled })
    .from(orgs)
    .where(eq(orgs.id, donor.orgId));

  if (!org) throw new Error(`assertSendable: org not found for donor: ${donorId}`);

  const consentRows = await db
    .select({ channel: consents.channel, state: consents.state })
    .from(consents)
    .where(eq(consents.donorId, donorId));

  const suppressionRows = await db
    .select({
      scope: suppressions.scope,
      startsAt: suppressions.startsAt,
      endsAt: suppressions.endsAt,
    })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.donorId, donorId),
        eq(suppressions.orgId, donor.orgId),
      ),
    );

  return checkSendability({
    channel,
    org,
    consents: consentRows,
    suppressions: suppressionRows.map(s => ({
      scope: s.scope,
      startsAt: s.startsAt,
      endsAt: s.endsAt ?? null,
    })),
    globalSendEnabled: env.SEND_ENABLED,
  });
}
