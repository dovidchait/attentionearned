# Donor Stewardship Engine — Claude Code Build Spec

**Status:** v1.0 — buildable
**Purpose:** A single document you can hand to Claude Code as the anchor for building the stewardship offering. Contains the architecture, data model, phase plan with acceptance criteria, and the guardrails that keep an agent from shipping something that messages real donors by accident.

---

## 0. Read this first (context for the agent)

We are building an **agency-operated donor stewardship engine** serving multiple nonprofit client organizations. Each client runs annual crowdfunding campaigns on Charidy or Causematch, acquiring 500–1,500 mostly small donors (~$36 average). Those donors currently receive nothing after the campaign ends.

The system ingests campaign donor lists, decides what to say to whom and when, selects matching media, and delivers across WhatsApp, SMS, and email over a 12-month journey — with the goal of increasing 12-month revenue per acquired donor. A media-tagging layer lets specific donors (parents, grandparents) receive photos of *their* child over the year.

**The product is the donor graph and the decision logic. The channels are commodity.** Do not over-invest in channel adapters.

### v1 vs v2 scope — build v1 only

**v1 (this build):**
- Donor ingestion, dedupe, designation/attribution, consent, suppression
- Media service with **manual** subject tagging (a human tags who is in each photo)
- Journey engine, segmentation, three channels, reporting
- Shabbos/Yom Tov blackout via a **static timezone window** (not a candle-lighting data pipeline)

**v2 (explicitly deferred — do not build, but leave seams):**
- **Hatch enrichment** and the major-gift hand-raise export (§ marked v2 below)
- **Facial recognition** to pre-fill subject tags automatically (v1 does the same job with human tagging)
- **Precise candle-lighting-timed sends** via a zone/time pipeline (v1 uses a static blackout window)

Where a table or field exists only to make a v2 feature possible later, it is marked `-- v2`. Create the column if noted, but write no v2 logic.

### Non-goals (permanently out of scope)

- Building a general-purpose CRM. We store what we need to decide and report, nothing more.
- Payment processing. Gifts happen on Charidy/Causematch/the org's own page. We never touch money.
- Replacing the org's existing donor database. We are a satellite, not a system of record for the org's finance team.
- Social media publishing. That's a separate workflow on the same Zernio account; keep it out of this codebase.
- Any automated outreach to major-gift prospects. Those go to a human. See §5.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 20+) | Zernio ships a first-party Node SDK |
| Runtime | Long-running service + worker, not serverless | Scheduled sends and media transcode want durable processes |
| DB | Postgres 15+ | Relational data with heavy jsonb for enrichment payloads |
| Queue | pg-boss (Postgres-backed) | One less piece of infra; volumes are tiny (low thousands/day) |
| Migrations | Drizzle or Prisma — pick one, commit to it | |
| Media transcode | ffmpeg + sharp | Local binary, no service dependency |
| Object storage | S3-compatible (R2 or S3) | Renditions must be publicly fetchable by Meta at send time |
| Messaging | Zernio API (WhatsApp, SMS, phone numbers) | |
| Email | EmailIt | |
| Face embeddings | InsightFace (ArcFace) + pgvector | **v2 only** — v1 tags subjects manually |
| Enrichment | Hatch Partner API | **v2 only** |
| Admin UI | Deferred. Until then, CLI + SQL + a minimal internal tagging UI (§Phase 6) | |

Keep it boring. No microservices, no event sourcing, no GraphQL.

---

## 2. Architecture

```
  Charidy / Causematch CSV export         Photo/video shoots
              │                                   │
              ▼                                   ▼
      ┌───────────────┐                  ┌──────────────────┐
      │   Ingestion   │                  │  Media Ingest    │
      │ parse→norm→   │                  │  + manual subject │
      │ dedupe→desig  │                  │  tagging (human)  │
      └───────┬───────┘                  └────────┬─────────┘
              ▼                                    │  (v2: face-recog
      ┌───────────────┐  ┌ ─ ─ ─ ─ ─ ─ ─┐        │   pre-fills tags)
      │  Donor Graph  │◄─ Hatch Enrich   │        ▼
      │  (Postgres)   │  └ ─ (v2) ─ ─ ─ ─┘  ┌──────────────┐
      └───────┬───────┘                     │Media Service │
              │                             │select+transcode
       ┌──────┴───────┐                     └──────┬───────┘
       ▼              ▼                            │
 ┌───────────┐  ┌ ─ ─ ─ ─ ─ ─┐                     │
 │ Segmenter │  Hand-raise    │ (v2, HUMAN ONLY)   │
 └─────┬─────┘  └ ─ ─ ─ ─ ─ ─ ┘                     │
       ▼                                            │
┌────────────────┐◄──────────────────────────────┘
│ Journey Engine │  matches donor→subject for "your child" media
└───────┬────────┘
        ▼
┌────────────────────────────────────┐
│ Scheduler (static Shabbos blackout) │  v2: precise candle-lighting
└───────┬────────────────────────────┘
        ▼
┌──────────────┬──────────────┐
│    Zernio    │   EmailIt    │
│ WhatsApp/SMS │    Email     │
└──────┬───────┴──────┬───────┘
       │  webhooks    │
       ▼              ▼
   ┌──────────────────────┐
   │ Event ingest → Graph  │──► Org reporting
   └──────────────────────┘
```

---

## 3. Data model

All money in **integer cents**. All timestamps stored **UTC**, rendered in donor-local time. All phone numbers **E.164**.

```sql
-- Client nonprofits
orgs(
  id, slug, name, status,                  -- status: onboarding | live | paused | offboarded
  default_timezone,
  zernio_profile_id, zernio_phone_number_id,
  waba_owner,                              -- 'client' | 'agency'  (see §9 open decisions)
  emailit_sender_domain,
  send_enabled boolean default false,      -- master kill switch, per org
  created_at, updated_at
)

campaigns(
  id, org_id, platform,                    -- 'charidy' | 'causematch' | 'manual'
  external_id, name, starts_at, ends_at, goal_cents
)

donors(
  id, org_id,
  first_name, last_name, hebrew_name,
  email, phone_e164,
  address_line1, city, region, postal_code, country,
  timezone,                                -- IANA tz; drives the static Shabbos blackout (§5.12)
  candle_lighting_zone_id,                 -- v2 ONLY, nullable; unused until precise candle-lighting ships
  first_gift_at, last_gift_at,
  lifetime_cents, gift_count,
  ladder_stage,                            -- 'new' | 'stewarded' | 'repeat' | 'recurring' | 'mid' | 'major_referred'
  dedupe_key,                              -- normalized email|phone|name+zip
  created_at, updated_at,
  UNIQUE(org_id, dedupe_key)
)

gifts(
  id, org_id, donor_id, campaign_id,
  amount_cents, currency, occurred_at,
  designation_id,                          -- nullable
  dedication_text, team_referrer,
  is_recurring, recurring_interval,
  platform, external_id,
  UNIQUE(org_id, platform, external_id)
)

-- The unit-economics library. Drives attribution copy AND the upgrade ladder.
designations(
  id, org_id,
  key,                                     -- 'siddur'
  unit_noun_singular, unit_noun_plural,    -- 'siddur' / 'siddurim'
  unit_amount_cents,                       -- 1800
  impact_phrase,                           -- 'put a siddur in a child's hands'
  ladder_next_id,                          -- FK to the next rung up
  sort_order, active
)

-- v2 ONLY. Create the table so the FK/report seams exist; write no enrichment logic in v1.
enrichments(
  id, donor_id, provider,                  -- 'hatch'
  matched boolean, match_confidence,
  capacity_score, affinity_score, propensity_score,
  raw jsonb,
  fetched_at,
  UNIQUE(donor_id, provider)
)

consents(
  id, donor_id, channel,                   -- 'whatsapp' | 'sms' | 'email'
  state,                                   -- 'opted_in' | 'opted_out' | 'unknown'
  source,                                  -- 'campaign_checkbox' | 'reply_stop' | 'manual' | 'inferred'
  evidence jsonb,
  updated_at,
  UNIQUE(donor_id, channel)
)

suppressions(
  id, org_id, donor_id, reason, scope,     -- scope: 'all' | channel
  starts_at, ends_at                       -- supports temporary holds (shiva, aveilus, complaint cooldown)
)

media_assets(
  id, org_id, kind,                        -- 'image' | 'video' | 'audio'
  original_uri, original_bytes, mime,
  captured_at, expires_at,                 -- assets go stale; enforce it
  designation_id,                          -- nullable
  tags text[],                             -- 'children','classroom','seasonal:chanukah','no_faces'
  faces_present boolean,
  release_on_file boolean,                 -- consent/photo release — REQUIRED true to send
  tagging_state,                           -- 'untagged' | 'tagged' | 'no_subjects'  (see subject tagging below)
  usage_count, last_used_at
)

-- ── Subject tagging (v1: MANUAL) ─────────────────────────────────────────────
-- Lets specific donors receive photos of THEIR child across the year.
-- v1: a human tags who appears in each asset. v2: face recognition pre-fills
-- the same media_asset_subjects rows as 'auto' suggestions for human confirm.

subjects(
  id, org_id, display_name,                -- 'Dovid G.' — internal label, not shown to donors
  enrolled_at, enrollment_asset_id,        -- the reference photo (used by v2 face-recog only)
  biometric_consent_on_file boolean default false,  -- v2 REQUIRED before any embedding; irrelevant to v1 manual tagging
  photo_consent_on_file boolean default false,      -- v1 REQUIRED: parental OK to send this child's image to family
  consent_evidence jsonb,
  active boolean default true
)

-- v2 ONLY. Create table + enable pgvector, but populate nothing in v1.
subject_embeddings(
  id, subject_id, embedding vector(512),   -- ArcFace
  source_asset_id, created_at
)

media_asset_subjects(
  id, asset_id, subject_id,
  confidence,                              -- 1.0 for human tags; model score for v2 auto tags
  method,                                  -- v1: always 'human_confirmed'. v2 adds 'auto' (suggestion only)
  confirmed_by, confirmed_at,              -- who confirmed; null while method='auto' and unconfirmed
  UNIQUE(asset_id, subject_id)
)

-- Which donors should receive a given subject's media, and how they're related.
-- Verified by a human at the org — never inferred.
donor_subject_links(
  id, donor_id, subject_id,
  relationship,                            -- 'parent' | 'grandparent' | 'other'
  verified_by, verified_at,
  UNIQUE(donor_id, subject_id)
)

media_renditions(
  id, asset_id, channel,                   -- 'whatsapp' | 'email'
  uri, bytes, mime, width, height, duration_ms,
  spec_version,
  UNIQUE(asset_id, channel, spec_version)
)

templates(
  id, org_id, channel, key, version,
  body,                                    -- with {{variable}} slots
  variables text[],
  has_media_header boolean,
  meta_template_name, meta_status,         -- 'draft'|'pending'|'approved'|'rejected'
  approved_at
)

journeys(
  id, org_id, key, version, active,
  definition jsonb                         -- see §6
)

journey_enrollments(
  id, donor_id, journey_id,
  state,                                   -- 'active'|'completed'|'exited'
  current_step_key, enrolled_at, exited_at, exit_reason
)

touches(
  id, donor_id, org_id, journey_id, step_key,
  channel, template_id, asset_id,
  ask_amount_cents,                        -- null for pure-stewardship touches
  variables jsonb,                         -- resolved values
  scheduled_for, send_bucket_id,
  status,                                  -- 'planned'|'queued'|'sent'|'delivered'|'read'|'failed'|'skipped'
  skip_reason,
  provider, provider_message_id,
  sent_at
)

events(
  id, donor_id, touch_id, type,            -- 'delivered'|'read'|'replied'|'clicked'|'failed'|'opt_out'|'gift'
  payload jsonb, occurred_at
)

-- v1 Shabbos/Yom Tov blackout: a static, generous window per timezone.
-- Weekly Shabbos is computed (Fri afternoon → Sat night in local tz);
-- yom_tov_dates is a hand-maintained list of full-day blackout dates.
yom_tov_dates(
  id, gregorian_date, name,
  blackout_starts_local time,              -- e.g. erev starts ~14:00 local
  blackout_ends_local time,
  UNIQUE(gregorian_date)
)

-- v2 ONLY — precise candle-lighting pipeline. Create nothing until v2.
candle_lighting_zones(
  id, name, latitude, longitude,
  postal_code_prefixes text[]
)
candle_lighting_times(
  zone_id, gregorian_date, candle_lighting_at_utc,
  UNIQUE(zone_id, gregorian_date)
)
```

---

## 4. Repo layout

```
/
├── CLAUDE.md                  # see §10 — seed this first
├── docs/
│   ├── build-spec.md          # this file
│   ├── decisions/             # ADRs, one file per decision
│   └── runbooks/
├── src/
│   ├── db/                    # schema, migrations, seeds
│   ├── ingestion/
│   │   ├── charidy.ts
│   │   ├── causematch.ts
│   │   ├── normalize.ts
│   │   └── dedupe.ts
│   ├── enrichment/hatch.ts    # v2 — stub only in v1
│   ├── consent/
│   ├── designations/
│   ├── media/
│   │   ├── ingest.ts
│   │   ├── transcode.ts       # ffmpeg/sharp → channel specs
│   │   ├── subjects.ts        # subject enrollment + manual tagging + donor links
│   │   ├── recognition.ts     # v2 — InsightFace embeddings; stub only in v1
│   │   └── select.ts          # asset choice per donor/touch (incl. "their child")
│   ├── journeys/
│   │   ├── engine.ts
│   │   ├── definitions/       # versioned journey JSON
│   │   └── segments.ts
│   ├── scheduling/
│   │   ├── shabbos-blackout.ts # v1 static window + yom tov table
│   │   ├── candle-lighting.ts  # v2 — stub only in v1
│   │   └── buckets.ts
│   ├── channels/
│   │   ├── zernio.ts          # WhatsApp + SMS
│   │   ├── emailit.ts
│   │   └── types.ts           # shared Channel interface
│   ├── webhooks/
│   ├── reporting/
│   └── cli/
├── test/
│   ├── fixtures/              # anonymized CSVs, never real donor data
│   └── ...
└── scripts/
```

---

## 5. Hard guardrails

These are non-negotiable and must be enforced in code, not convention. Write tests for each.

1. **No send may occur unless ALL of:** `orgs.send_enabled = true`, global `SEND_ENABLED=true`, org status is `live`, and the touch passed the consent check. Default every one of these to false/off.
2. **`DRY_RUN=true` is the default in every environment except production.** In dry run, channel adapters write a `touches` row with status `sent` and a fake provider id, and log the fully rendered payload. They make no network call.
3. **Consent check is a single function** (`assertSendable(donorId, channel)`) called inside the channel adapter, not by callers. It checks `consents`, `suppressions`, and hard-bounce/opt-out events. No adapter may bypass it.
4. **Opt-out propagates immediately and irreversibly** via automation. A STOP on SMS suppresses SMS. A WhatsApp block suppresses WhatsApp. An unsubscribe suppresses email. Only a human may reverse a suppression.
5. **Media may not be sent unless `release_on_file = true`.** Photos of children without a release do not go out, ever, under any code path. This is a legal and a moral line.
6. **A "their child" media send requires ALL of:** a `human_confirmed` row in `media_asset_subjects`, `subjects.photo_consent_on_file = true`, and a human-verified `donor_subject_links` row. An `auto` (v2 face-recog) tag is a suggestion and can NEVER gate a send on its own — it must be confirmed by a human first. Wrong-child delivery is a client-ending event; treat this threshold as absolute.
7. **Biometric data (v2) requires `subjects.biometric_consent_on_file = true` before any embedding is computed.** No consent, no faceprint, ever. v1 stores no embeddings at all. Deleting a subject purges embeddings and re-derives tags; offboarding an org purges its biometric data entirely.
8. **Enrichment-flagged high-capacity donors are never auto-enrolled in an upgrade ask.** They route to the hand-raise export for human contact. (v2 — but the exclusion rule holds the moment enrichment exists.)
9. **No PII in logs.** Log donor/subject ids, never names/emails/phones/faces. Add a lint rule or logger redactor.
10. **Never commit real donor data, CSVs, API keys, enrichment payloads, or any photo of a real child.** Test fixtures are synthetic. Add them to `.gitignore` by directory, not by filename.
11. **Rate-limit and idempotency-key every outbound provider call.** Zernio documents idempotent retries — use them. A retry storm that double-sends to 1,000 donors is unrecoverable reputationally.
12. **Every scheduled send passes the Shabbos/Yom Tov blackout guard.** v1 uses a static window: no sends from Friday ~2pm through Saturday ~9pm in the donor's local timezone (`donors.timezone`), plus any date in `yom_tov_dates`. Fail closed: if a donor's timezone is unknown, skip the touch and alert — never send.

---

## 6. Journey definition format

Journeys are versioned JSON, stored in `journeys.definition`, authored in `src/journeys/definitions/`. The engine evaluates them; it does not contain campaign logic.

```jsonc
{
  "key": "post_campaign_year_one",
  "version": 3,
  "entry": {
    "trigger": "gift_received",
    "conditions": [
      { "field": "gift.amount_cents", "op": "lt", "value": 50000 },
      { "field": "donor.gift_count", "op": "eq", "value": 1 }
    ]
  },
  "exit_conditions": [
    { "field": "donor.ladder_stage", "op": "eq", "value": "recurring" },
    { "event": "opt_out" }
  ],
  "steps": [
    {
      "key": "thank_you_attributed",
      "offset": { "hours": 18 },
      "channel": "whatsapp",
      "fallback_channels": ["email"],
      "template_key": "thank_you_v2",
      "media": { "selector": "designation_match", "tags": ["no_faces"] },
      "ask": null
    },
    {
      "key": "erev_shabbos_1",
      // v1: fixed local send time, clamped by the static Shabbos blackout guard.
      // v2 swaps this for { "type": "candle_lighting", "offset_minutes": -180 }.
      "schedule": { "type": "local_time", "weekday": "friday", "at": "11:00" },
      "recurrence": { "weeks": 2, "count": 8 },
      "channel": "whatsapp",
      "template_key": "erev_shabbos_bracha",
      "media": { "selector": "rotating_seasonal" },
      "ask": null
    },
    {
      "key": "your_child_photo",
      "offset": { "days": 120 },
      "channel": "whatsapp",
      "fallback_channels": ["email"],
      "template_key": "your_child_update",
      // Sends a photo of THIS donor's linked subject. Requires guardrail §5.6.
      // If the donor has no linked subject, or no confirmed asset exists, the
      // step is skipped (skip_reason='no_subject_media'), not sent generic.
      "media": { "selector": "linked_subject", "require_confirmed": true },
      "ask": null
    },
    {
      "key": "recurring_conversion",
      "offset": { "days": 45 },
      "channel": "whatsapp",
      "template_key": "monthly_invite",
      "ask": { "type": "recurring", "amount_cents": 1000, "interval": "month" }
    }
  ]
}
```

**Design rule:** the ratio of no-ask touches to ask touches should be at least 4:1. Enforce it with a lint check on journey definitions — the engine should refuse to load a journey that violates it.

---

## 7. Build phases

Each phase must be independently shippable and testable. Do not start the next phase until acceptance criteria pass.

### Phase 0 — Foundation
Scaffold, Postgres schema, migrations, org/donor/gift/campaign models, seed script, CLI skeleton, structured logging with PII redaction.
**Accept:** `npm run db:migrate && npm run seed` produces a working org with synthetic donors. Test suite runs in CI.

### Phase 1 — Ingestion
Charidy and Causematch CSV parsers behind a common `ImportAdapter` interface. Normalization (names, phone → E.164, address, postal code). Deduplication with a documented, testable match strategy. Import produces a diff report before commit (`--dry-run` shows creates/updates/conflicts).
**Accept:** Import the same file twice → zero duplicate donors, zero duplicate gifts. Import a file with 20 known edge cases (missing phone, non-US number, married-couple name, dedication with emoji) → all handled or explicitly quarantined for review.

### Phase 2 — Designations & consent
Designation library CRUD, attribution resolver (gift amount + designation → impact phrase and unit count), consent model, suppression model, `assertSendable()`.
**Accept:** Given a $54 gift against the `siddur` designation, the resolver returns "3 siddurim." Consent tests cover every path in guardrail §5.3–5.4.

### Phase 3 — Media service + manual subject tagging
Asset ingest with tagging, release-on-file enforcement, ffmpeg/sharp transcode to channel specs (WhatsApp: JPEG/PNG ≤5MB; MP4 ≤16MB), rendition cache in object storage, asset selector with rotation and staleness rules. Subject model (`subjects`, `media_asset_subjects`, `donor_subject_links`) with **manual** tagging via CLI/minimal UI, and a `linked_subject` selector that returns a donor's own child's confirmed media. Enforce guardrails §5.5–5.7 in code.
**Accept:** A 40MB 4K MOV ingests and produces a compliant WhatsApp rendition. Selector never returns the same asset to the same donor twice within 90 days. Assets without a release are unselectable. A donor linked to subject X only ever receives assets with a `human_confirmed` tag for X and `photo_consent_on_file=true`; with none available, `linked_subject` returns nothing (never a fallback child). No embeddings exist anywhere in v1.

### Phase 4 — Channels
Zernio adapter (WhatsApp template send with variables + media header, SMS), EmailIt adapter, template registry with Meta approval status sync, webhook receiver mapping provider events → `events` rows, unified `Channel` interface with dry-run mode.
**Accept:** With `DRY_RUN=true`, a full send renders correct payloads for all three channels and touches no network. With a sandbox WABA, one real template message delivers and its webhook lands in `events`.

### Phase 5 — Journey engine & scheduling
Journey loader with validation (including the 4:1 lint), enrollment, step evaluation, `local_time` scheduling, bucket assignment, **static Shabbos/Yom Tov blackout guard** (§5.12) reading `donors.timezone` + `yom_tov_dates`, worker that materializes `touches` and dispatches. Evergreen fallback path when an org has no fresh media.
**Accept:** A simulated 12-month run over 1,000 synthetic donors produces the expected touch counts per segment, no touch lands in a Friday-afternoon-through-Saturday-night window in ANY represented timezone, no touch lands on a `yom_tov_dates` date, donors with unknown timezone are skipped-and-alerted (never sent), and per-donor touch frequency stays under the configured cap. Do NOT populate or read candle-lighting tables.

### Phase 6 — Tagging UI & reporting
Minimal internal web UI (single small app, not a full admin console) for the human workflows v1 needs: subject enrollment, tagging assets to subjects, linking donors to subjects, and confirming `release_on_file` / `photo_consent_on_file`. Per-org reporting: donors acquired, retention rate, second-gift rate, recurring conversions, 12-month revenue per acquired donor, median gift, touch performance by template. Monthly PDF for the ED.
**Accept:** A non-engineer can enroll a subject, tag ten assets, link three donors, and confirm consent entirely through the UI, and those tags correctly gate a simulated `linked_subject` send. Report generates from real ingested data and reconciles to the source CSV totals.

### Phase 7 (v2 — do not build in this pass) — Enrichment & hand-raise
Hatch Partner API client, batched enrichment on import, scoring normalization, hand-raise export (CSV + one-page PDF per prospect) with hard exclusion from automated ask steps (§5.8). Ship only after the Hatch Partner API multi-tenancy model is confirmed (§8).

### Phase 8 (v2 — do not build in this pass) — Face recognition
InsightFace embeddings behind biometric consent (§5.7), pgvector match against enrolled subjects, results written as `method='auto'` suggestions into the SAME `media_asset_subjects` table the Phase 6 UI already confirms. This is purely a labor-saver that pre-fills the human review queue — it changes no send logic and relaxes no guardrail. Requires a signed per-school facial-recognition consent instrument to exist first.

### Phase 9 (v2 — do not build in this pass) — Precise candle-lighting
Zone table, postal-code→zone mapping, calculated candle-lighting times, and `candle_lighting` journey scheduling replacing the v1 static window.

---

## 8. External integrations — what to confirm before coding against them

| Integration | Confirm first |
|---|---|
| Zernio | Multi-tenant profile model, per-profile scoped keys, WhatsApp broadcast variable limits, idempotency header name, webhook signature scheme, rate limits |
| Hatch (v2) | Partner API auth model, whether agency multi-tenancy is supported, batch size, per-record cost at your volume, refresh cadence. Confirm before Phase 7, not before v1. |
| Charidy / Causematch | Actual export column set — specifically whether phone, designation, team/referrer, and consent checkbox come through. This determines whether Phase 2 is possible at all. |
| EmailIt | Per-org sending domain, DKIM/SPF setup, bounce/complaint webhooks |
| Meta / WhatsApp | Template category rules for fundraising, per-conversation pricing in your donor geographies, WABA ownership transfer process |

Do not write adapters from assumptions. Get one real export and one real API response per integration and commit them as fixtures.

---

## 9. Open decisions blocking the build

These need answers before Phase 4. Record each as an ADR in `docs/decisions/`.

1. **WABA ownership: client or agency?** Determines onboarding flow, offboarding path, and contract language. Recommendation: client-owned, agency-operated.
2. **Attribution model: true designation tagging or general impact language?** True tagging requires changing the Charidy/Causematch checkout to capture designation at gift time — a client-side business conversation, not a code change. Everything in §3's `designations` table and §7 Phase 2 assumes the answer is "true tagging." If it's "general," Phase 2 shrinks and the upgrade ladder weakens.
3. **Touch frequency cap per donor per month**, given per-conversation Meta pricing. Drives unit economics and needs a real price quote.
4. **Capacity threshold for hand-raise routing**, and who at each org receives it.
5. **Data retention and deletion policy** — how long donor data, media, and (v2) enrichment/biometric payloads live, and what offboarding purges.
6. **Who does the manual subject tagging, and where?** Your photographer at shoot time, an org coordinator, or your team on intake? This is the operational cost of the "their child" feature and it determines how heavily to invest in the Phase 6 tagging UI.
7. **Photo-consent instrument for "their child" sends.** Before any child's image is routed to family, there must be a per-child parental consent captured somewhere. Decide whether that lives in your form, the org's registration, or the shoot release. This is a business artifact, not code, and it blocks the feature going live.
8. **(v2, but decide before collecting reference photos) Facial-recognition parental consent.** A distinct, explicit written consent naming facial recognition — separate from a photo release. Several US states (Illinois BIPA especially) treat a faceprint as regulated biometric data with statutory damages. Get one school to sign before building Phase 8; if they won't, you've learned it cheaply.

---

## 10. Seed `CLAUDE.md`

Put this at the repo root before the first Claude Code session.

```markdown
# Donor Stewardship Engine

Agency-operated, multi-tenant donor stewardship for nonprofit clients.
Full spec: docs/build-spec.md — read it before proposing architecture changes.

## Scope: BUILD v1 ONLY
v2 is deferred. Do NOT build: Hatch enrichment (Phase 7), face recognition
(Phase 8), precise candle-lighting sends (Phase 9). Create v2-marked columns
so seams exist, but write no v2 logic. If a task seems to need a v2 feature,
stop and ask.

## Absolute rules
- Never send a message unless DRY_RUN=false AND SEND_ENABLED=true AND
  org.send_enabled=true AND assertSendable() passed. All default off.
- Never log donor/subject names, emails, or phone numbers. IDs only.
- Never commit real donor data, CSVs, API keys, enrichment payloads, or any
  photo of a real child. Test fixtures are synthetic.
- Never send media where release_on_file is false.
- "Their child" media (linked_subject selector) requires a human_confirmed
  media_asset_subjects row + subjects.photo_consent_on_file=true + a verified
  donor_subject_links row. No confirmed match → send nothing, never a fallback
  child. Wrong-child delivery is a client-ending event.
- v1 stores NO face embeddings. subject_embeddings stays empty.
- Never route a high-capacity donor into an automated ask. Human only. (v2)
- Shabbos guard (v1): no sends Fri ~2pm–Sat ~9pm in donor-local tz, none on
  yom_tov_dates. Unknown timezone → skip and alert, never send.

## Conventions
- Money: integer cents, always. Never floats.
- Time: UTC in the database. Convert at render.
- Phones: E.164 in the database. Normalize at ingest.
- New external integration → write a fixture from a real response first,
  then code against the fixture.
- New journey step → must pass the 4:1 no-ask:ask lint.

## Commands
- npm run db:migrate
- npm run seed
- npm test
- npm run import -- --org <slug> --file <path> --dry-run
- npm run journey:simulate -- --org <slug> --months 12

## Working style
- One phase at a time (docs/build-spec.md §7). Do not start the next phase
  until the current phase's acceptance criteria pass.
- Ask before adding a dependency.
- Ask before changing the schema in §3.
```

---

## 11. What will actually go wrong

Worth naming so the build accounts for it:

- **Media supply dries up around month three.** Every journey needs an evergreen fallback path that runs when the org's content well is empty. Build it in Phase 5, not later.
- **Meta template rejections** will block launches on unpredictable timelines. Submit the full template library during Phase 3, in parallel with development, not at the end.
- **Charidy/Causematch exports won't have phone numbers for a meaningful fraction of donors.** Email becomes the fallback more often than planned. Make channel fallback a first-class concept in the journey format (it is, in §6 — keep it that way).
- **Dedupe will be wrong in the frum donor context** — many shared surnames, married couples giving under one name, Hebrew/English name variants. Budget real time for Phase 1 and keep a human review queue for ambiguous matches.
- **The first org's data will break every assumption in this document.** That's expected. Ingest one real export before Phase 2 starts.
- **Subject tagging will be the operational bottleneck of the "their child" feature.** Manual tagging is fine at hundreds of photos but resented at thousands. Keep the Phase 6 tagging UI fast (keyboard-driven, batch tagging), and design it so v2 face-recog can later pre-fill the same queue without reworking the workflow. Do not let the feature promise outrun the tagging labor available.
- **Wrong-child delivery is the single worst failure this system can produce.** It outranks a double-send or a Shabbos-window miss. The confirmation requirement in §5.6 is the mitigation; never add a code path that sends a "their child" asset on an unconfirmed or auto tag.
