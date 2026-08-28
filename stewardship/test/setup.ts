// Global test setup — runs before all test files
// Integration tests that need a DB will import from this file

import { afterAll } from 'vitest';

// Ensure env is loaded with test defaults
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/stewardship_test';
process.env['DRY_RUN'] = 'true';
process.env['SEND_ENABLED'] = 'false';
process.env['LOG_LEVEL'] = 'error'; // suppress logs in tests

afterAll(async () => {
  // Close the DB pool after the test suite completes
  try {
    const { pool } = await import('../src/lib/db.js');
    await pool.end();
  } catch {
    // Pool may not have been opened in unit tests — that's fine
  }
});
