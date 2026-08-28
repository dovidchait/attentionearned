import type { ImportAdapter, ParsedImport } from '../adapter.js';

/**
 * CausematchAdapter — Phase 1 skeleton.
 *
 * Causematch exports are CSVs. The exact column schema is TBD pending analysis
 * of a real Causematch export file. Once a real export is available:
 *   1. Commit it as a synthetic fixture (never the real file)
 *   2. Implement this adapter following the same patterns as CharidyAdapter
 *   3. Remove this NotImplementedError
 *
 * See docs/build-spec.md §8 for integration confirmation checklist.
 */
export class CausematchAdapter implements ImportAdapter {
  async parse(_filePath: string, _options: { campaignExternalId: string }): Promise<ParsedImport> {
    throw new Error(
      'CausematchAdapter is not yet implemented. ' +
      'Analyze a real Causematch export file first, then implement the column mappings. ' +
      'See docs/build-spec.md §8.',
    );
  }
}
