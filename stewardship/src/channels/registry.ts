import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { templates } from '../schema/index.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import type { TemplateRecord, ChannelKind } from './interface.js';

export type { TemplateRecord };

export async function getTemplate(
  orgId: string,
  channel: ChannelKind,
  key: string,
): Promise<TemplateRecord | null> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.channel, channel), eq(templates.key, key)))
    .limit(1);

  if (!row) return null;
  return row as TemplateRecord;
}

export async function upsertTemplate(
  orgId: string,
  data: Omit<TemplateRecord, 'id' | 'orgId'>,
): Promise<TemplateRecord> {
  const [row] = await db
    .insert(templates)
    .values({ orgId, ...data })
    .onConflictDoUpdate({
      target: [templates.orgId, templates.key, templates.channel],
      set: {
        body: data.body,
        variables: data.variables,
        hasMediaHeader: data.hasMediaHeader,
        metaTemplateName: data.metaTemplateName,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row as TemplateRecord;
}

/**
 * Syncs Meta approval status for all WhatsApp templates in an org.
 * Calls Zernio's GET /v1/templates endpoint which proxies the Meta Business API.
 *
 * Marks templates as 'approved' or 'rejected' based on Meta's response.
 * Unknown templates (not yet submitted) are left as 'pending'.
 */
export async function syncMetaApprovalStatus(orgId: string): Promise<void> {
  const apiKey = env.ZERNIO_API_KEY;
  if (!apiKey) {
    logger.warn('ZERNIO_API_KEY not set — skipping Meta approval status sync');
    return;
  }

  const res = await fetch(`${env.ZERNIO_BASE_URL}/v1/templates`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const detail = await res.text();
    logger.error({ orgId }, `Meta template sync failed: ${res.status} ${detail}`);
    return;
  }

  interface MetaTemplate {
    name: string;
    status: 'APPROVED' | 'REJECTED' | 'PENDING';
    id: string;
  }
  const { data: metaTemplates } = await res.json() as { data: MetaTemplate[] };
  const metaMap = new Map(metaTemplates.map(t => [t.name, t.status]));

  const orgTemplates = await db
    .select({ id: templates.id, metaTemplateName: templates.metaTemplateName })
    .from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.channel, 'whatsapp')));

  for (const tmpl of orgTemplates) {
    if (!tmpl.metaTemplateName) continue;
    const metaStatus = metaMap.get(tmpl.metaTemplateName);
    if (!metaStatus) continue;

    const normalized = metaStatus.toLowerCase() as 'approved' | 'rejected' | 'pending';
    await db
      .update(templates)
      .set({
        metaStatus: normalized,
        approvedAt: normalized === 'approved' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, tmpl.id));

    logger.info({ templateId: tmpl.id, metaStatus: normalized }, 'Updated Meta approval status');
  }
}
