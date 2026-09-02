import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { templates } from '../schema/index.js';
import type { Template, NewTemplate } from '../schema/index.js';

export type { Template, NewTemplate };

export interface UpsertTemplateInput {
  channel: string;
  key: string;
  version?: string;
  body: string;
  variables?: string[];
  hasMediaHeader?: boolean;
  metaTemplateName?: string;
  metaStatus?: string;
}

/** Insert or replace a template by (orgId, key, channel, version). */
export async function upsertTemplate(orgId: string, input: UpsertTemplateInput): Promise<Template> {
  const version = input.version ?? '1';

  const values: NewTemplate = {
    orgId,
    channel: input.channel,
    key: input.key,
    version,
    body: input.body,
    variables: input.variables ?? [],
    hasMediaHeader: input.hasMediaHeader ?? false,
    metaTemplateName: input.metaTemplateName ?? null,
    metaStatus: input.metaStatus ?? 'draft',
  };

  const [row] = await db
    .insert(templates)
    .values(values)
    .onConflictDoUpdate({
      target: [templates.orgId, templates.key, templates.channel, templates.version],
      set: {
        body: values.body,
        variables: values.variables,
        hasMediaHeader: values.hasMediaHeader,
        metaTemplateName: values.metaTemplateName,
        metaStatus: values.metaStatus,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

/** Get the latest version of a template for an org + key + channel. */
export async function getTemplate(orgId: string, key: string, channel: string): Promise<Template> {
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.orgId, orgId),
        eq(templates.key, key),
        eq(templates.channel, channel),
      ),
    );

  if (rows.length === 0) throw new Error(`Template not found: ${key} / ${channel}`);

  // Prefer approved, fall back to latest by version string
  const approved = rows.find(r => r.metaStatus === 'approved');
  return approved ?? rows[rows.length - 1];
}

export async function listTemplates(orgId: string): Promise<Template[]> {
  return db.select().from(templates).where(eq(templates.orgId, orgId));
}

export async function setMetaStatus(
  templateId: string,
  status: string,
  approvedAt?: Date,
): Promise<void> {
  await db
    .update(templates)
    .set({ metaStatus: status, approvedAt: approvedAt ?? null, updatedAt: new Date() })
    .where(eq(templates.id, templateId));
}
