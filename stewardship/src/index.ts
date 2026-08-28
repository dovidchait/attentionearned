import { logger } from './lib/logger.js';
import { env } from './lib/env.js';
import { pool } from './lib/db.js';

async function main() {
  logger.info({ dryRun: env.DRY_RUN, sendEnabled: env.SEND_ENABLED }, 'Stewardship engine starting');

  if (env.DRY_RUN) {
    logger.warn('DRY_RUN=true — no messages will be sent. Set DRY_RUN=false in production.');
  }

  if (!env.SEND_ENABLED) {
    logger.warn('SEND_ENABLED=false — send pipeline is globally disabled.');
  }

  // TODO Phase 5: initialize pg-boss worker and start journey engine
  // For Phase 0, just confirm the DB connection is healthy.
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();

  logger.info('DB connection healthy. Engine ready.');

  // Keep process alive (worker loop goes here in Phase 5)
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
