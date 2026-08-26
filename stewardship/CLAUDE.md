# Stewardship Engine

Agency-operated, multi-tenant donor stewardship for nonprofit clients.
Full spec: `../docs/build-spec.md` — read it before proposing architecture changes.

This is a standalone package inside the `attentionearned` repo. Do NOT modify files above `/stewardship/`.

## Scope: BUILD v1 ONLY

v2 is deferred. Do NOT build: Hatch enrichment (Phase 7), face recognition (Phase 8),
precise candle-lighting sends (Phase 9). Create v2-marked schema stubs so seams exist,
but write no v2 logic. If a task seems to need a v2 feature, stop and ask.

## Absolute rules

- **Never send** unless `DRY_RUN=false` AND `SEND_ENABLED=true` AND `org.send_enabled=true` AND `campaign.send_enabled=true` AND `assertSendable()` passed. All default off.
- **Never log** donor/subject names, emails, or phone numbers. IDs only. Use `logger.ts` serializers.
- **Never commit** real donor data, CSVs, API keys, enrichment payloads, or any photo of a real child. Test fixtures are synthetic.
- **Never send media** where `release_on_file` is false.
- **"Their child" media** (`linked_subject` selector) requires a `human_confirmed` row in `media_asset_subjects` + `subjects.photo_consent_on_file=true` + a human-verified `donor_subject_links` row. No confirmed match → send nothing, never a fallback child. Wrong-child delivery is a client-ending event.
- **v1 stores NO face embeddings.** `subject_embeddings` stays empty.
- **Shabbos guard (v1):** no sends Fri ~2pm–Sat ~9pm in donor-local tz, none on `yom_tov_dates`. Unknown timezone → skip and alert, never send.
- **Conflicts are NEVER silently resolved.** They surface in the diff report.

## Conventions

- **Money:** integer cents, always. `Math.round(parseFloat(raw) * 100)`. Never floats.
- **Timestamps:** UTC in the DB. Convert at render. Excel serial dates: `excelSerialToDate()` in `charidy.ts`.
- **Phones:** E.164 in the DB. `normalizePhone()` in `normalizer.ts`. Never store raw phone strings.
- **New external integration:** write a fixture from a real response first, then code against the fixture.
- **New journey step:** must pass the 4:1 no-ask:ask lint.

## Commands

```bash
cd stewardship
cp .env.example .env   # fill in DATABASE_URL
npm install
npm run db:migrate
npm run seed
npm test
npm run import -- --adapter charidy --campaign <external_id> [--dry-run] <file.xlsx>
npm run journey:simulate -- --org <slug> --months 12
```

## Testing

```bash
npm test          # all tests (requires live Postgres for integration tests)
npm run test:watch
```

Integration tests require `DATABASE_URL` pointing at a Postgres 15 instance.
Set `DATABASE_URL=postgres://postgres:postgres@localhost:5432/stewardship_test` for local testing.

## Migrations

```bash
npm run db:generate   # after editing src/schema/
npm run db:migrate    # applies pending migrations
```

**NEVER edit generated migration files in `migrations/`.** Add new migrations instead.

## Import CLI

```bash
npm run import -- --adapter charidy --campaign <external_id> [--dry-run] <file.xlsx>
```

`--dry-run` is the default. Pass `--no-dry-run` to commit to DB.

## Adapter contract

- `ImportAdapter` interface: `src/ingestion/adapter.ts`
- Charidy: `src/ingestion/adapters/charidy.ts`
- Causematch: `src/ingestion/adapters/causematch.ts` (skeleton — fill in once real export analyzed)

## Dedupe key priority

`email > phone > name+zip`. See `src/ingestion/deduplicator.ts` for full spec.

## Working style

- One phase at a time (`../docs/build-spec.md` §7). Do not start the next phase until the current phase's acceptance criteria pass.
- Ask before adding a dependency.
- Ask before changing the schema in `../docs/build-spec.md` §3.
