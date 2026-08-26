import { Command } from 'commander';
import { logger } from '../../lib/logger.js';
import { runImport } from '../../ingestion/importer.js';
import { pool } from '../../lib/db.js';

export const importCommand = new Command('import')
  .description('Import donor data from a platform export file')
  .requiredOption('--adapter <adapter>', 'Import adapter to use: charidy | causematch')
  .requiredOption('--org <slug>', 'Organization slug')
  .requiredOption('--campaign <external_id>', 'Platform campaign external ID')
  .option('--dry-run', 'Preview import without writing to DB (default: true)', true)
  .option('--no-dry-run', 'Commit import to DB')
  .argument('<file>', 'Path to the export file')
  .action(async (file: string, opts: { adapter: string; org: string; campaign: string; dryRun: boolean }) => {
    const log = logger.child({ command: 'import' });

    if (opts.dryRun) {
      log.info('DRY RUN mode — no changes will be written to the database');
    }

    try {
      const summary = await runImport(file, {
        orgSlug: opts.org,
        campaignExternalId: opts.campaign,
        adapter: opts.adapter as 'charidy' | 'causematch',
        dryRun: opts.dryRun,
      });

      console.log('\nImport summary:');
      console.log(`  Donors:  ${summary.donorsCreated} created, ${summary.donorsUpdated} updated, ${summary.conflicts} conflicts`);
      console.log(`  Gifts:   ${summary.giftsCreated} created, ${summary.giftsSkipped} already existed`);
      console.log(`  Quarantined: ${summary.quarantined} rows`);

      if (opts.dryRun) {
        console.log('\nDRY RUN — no changes written. Pass --no-dry-run to commit.');
      }
    } catch (err) {
      log.error({ err }, 'Import failed');
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  });
