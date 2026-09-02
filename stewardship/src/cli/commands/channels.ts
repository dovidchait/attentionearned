import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orgs } from '../../schema/index.js';
import { upsertTemplate, listTemplates } from '../../templates/index.js';
import { sendTouch } from '../../channels/index.js';
import { createWebhookServer } from '../../webhooks/server.js';

export const templateUpsertCommand = new Command('template:upsert')
  .description('Insert or update a template')
  .requiredOption('--org <slug>', 'Org slug')
  .requiredOption('--key <key>', 'Template key (e.g. thank_you_v2)')
  .requiredOption('--channel <channel>', 'Channel: whatsapp | sms | email')
  .requiredOption('--body <text>', 'Template body with {{variable}} slots')
  .option('--version <v>', 'Version string', '1')
  .option('--meta-name <name>', 'Meta template name (WhatsApp only)')
  .option('--has-media', 'Template has a media header', false)
  .option('--variable <var...>', 'Variable names (repeatable)')
  .action(async (opts: {
    org: string; key: string; channel: string; body: string;
    version: string; metaName?: string; hasMedia: boolean; variable?: string[];
  }) => {
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, opts.org));
    if (!org) { console.error(`Org not found: ${opts.org}`); process.exitCode = 1; return; }

    const tmpl = await upsertTemplate(org.id, {
      key: opts.key,
      channel: opts.channel,
      body: opts.body,
      version: opts.version,
      metaTemplateName: opts.metaName,
      hasMediaHeader: opts.hasMedia,
      variables: opts.variable,
    });

    console.log(`Template upserted: ${tmpl.id}`);
    console.log(`  key: ${tmpl.key}, channel: ${tmpl.channel}, version: ${tmpl.version}`);
    console.log(`  meta_status: ${tmpl.metaStatus}`);
  });

export const templateListCommand = new Command('template:list')
  .description('List all templates for an org')
  .requiredOption('--org <slug>', 'Org slug')
  .action(async (opts: { org: string }) => {
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, opts.org));
    if (!org) { console.error(`Org not found: ${opts.org}`); process.exitCode = 1; return; }

    const rows = await listTemplates(org.id);
    if (rows.length === 0) { console.log('No templates found.'); return; }

    for (const t of rows) {
      console.log(`${t.key}  channel=${t.channel}  v${t.version}  status=${t.metaStatus}  id=${t.id}`);
    }
  });

export const sendTouchCommand = new Command('send:touch')
  .description('Send a planned touch by ID (use for manual testing)')
  .argument('<touch-id>', 'Touch UUID')
  .action(async (touchId: string) => {
    await sendTouch(touchId);
    console.log(`Touch ${touchId} processed.`);
  });

export const webhooksServeCommand = new Command('webhooks:serve')
  .description('Start the webhook HTTP receiver')
  .option('--port <n>', 'Port to listen on (default: WEBHOOK_PORT env or 3001)')
  .action((opts: { port?: string }) => {
    const port = opts.port ? parseInt(opts.port, 10) : undefined;
    createWebhookServer(port);
    // Keep process alive
    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGINT', () => process.exit(0));
  });
