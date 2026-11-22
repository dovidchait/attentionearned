# Studio / Content Engine — Build Plan

## What we're building
A DIY content creation and distribution tool for small NPOs and small businesses,
hosted at attentionearned.com/studio. Public lead gen + internal client tool.
No AI video. User uploads their own footage.

## What already exists
- `src/pages/api/content/start.ts` — submit video URL to AssemblyAI for transcription
- `src/pages/api/content/result.ts` — poll transcript, generate Instagram/LinkedIn captions via Claude Haiku (`?captions=0` skips captions)
- `src/pages/api/content/accounts.ts` — fetch connected social accounts from Zernio
- `src/pages/api/content/post.ts` — schedule/post video to social platforms via Zernio
- `fly-service/index.js` — SMS/WhatsApp/email-triggered posting via Twilio + Late.dev
- `stewardship/` — org/donor/campaign DB (Postgres + Drizzle) — reuse for org settings
- `client-dashboard/` — Express app on Fly with its own magic-link login; overlaps with Studio (see Status and notes)

## Stack decisions
- **Framework:** Astro (already in use), SSR on Vercel
- **Auth:** Clerk (handles login for both internal clients and public lead gen)
- **Social accounts:** Zernio REST API (ZERNIO_API_KEY already in env)
  - White-label branded OAuth connect screens (configured in Zernio dashboard)
  - Multi-tenant: one Zernio profile per org, store profile._id against Clerk user
- **Transcription:** AssemblyAI (already wired)
- **Captions/copy:** Claude Haiku via Anthropic API (already wired)
- **Graphics:** Ideogram API (new — one endpoint, one UI step)
- **Posting/scheduling:** Zernio (already wired)

## Build order

### 1. Landing page
- [x] `/studio` — public marketing page explaining the tool (`src/pages/studio/index.astro`)
- [x] CTA → sign up / log in

### 2. Auth
- [x] Install `@clerk/astro`; Clerk middleware in `src/middleware.ts`
- [x] `/studio/login` and `/studio/signup` pages
- [x] Middleware protects `/studio/dashboard`, `/studio/create`, `/studio/accounts`, `/studio/settings` and `/api/studio/*`
  - Clerk's `clerk()` integration is **not** used: it injects a Clerk loader into every page, marketing site included. Clerk JS loads only on Studio pages (`src/lib/studio/clerk-client.ts`).

### 3. Zernio profile provisioning
- [x] On first login: `POST /profiles` with Clerk user ID as `externalId` (runs on the first Studio request, `src/lib/studio/session.ts`)
- [x] Store returned `profile._id` in Clerk `privateMetadata.studio` (not the stewardship DB; see Decisions)
- [x] Skip if profile already exists

### 4. Social account connect flow
- [x] "Connect accounts" page — list connected accounts, add new (`/studio/accounts`)
- [x] `GET /connect/{platform}?profileId=...&redirect_url=...` → redirect user (`/api/studio/connect/start/[platform]`)
- [x] Callback handler — passes `connect_token` + step to Zernio select endpoint (`/api/studio/connect/callback`)
- [x] Per-platform select steps (Facebook → `select_page`, LinkedIn → `select_profile`), run with no page picker (see Known gaps)
- [ ] Branded screens already configured in Zernio white-label settings — set in the Zernio dashboard; not checked from the code

### 5. Content creation UI
- [x] `/studio/create` — main creation flow (five steps on one page)
- [x] Step 1: Upload video file (direct PUT to Zernio storage via presigned URL) or paste URL
- [x] Step 2: Transcribe via AssemblyAI (`/api/content/start` + `/api/content/result?captions=0`)
- [x] Step 3: Review/edit captions (Instagram, LinkedIn, TikTok) — `/api/studio/captions`
- [x] Step 4: Generate graphic — describe → Ideogram → copied to Zernio storage → pick. **Built but not run:** no `IDEOGRAM_API_KEY`, and the Ideogram docs were unreachable, so the request and response shape are unverified
- [x] Step 5: Select accounts, pick date/time → schedule via Zernio (`/api/studio/posts`; retries do not double-post)

### 6. Content calendar
- [x] `/studio/dashboard` — calendar view of scheduled posts (list view: upcoming and recent)
- [x] `GET /posts?profileId=...` to pull scheduled/published posts (first 100)
- [x] Grid or list view with status (scheduled, published, failed)
- [x] Click post → edit caption or reschedule; delete (`/api/studio/posts/[id]`)

### 7. Org settings
- [x] Voice/tone fields (feed the caption prompt)
- [x] Campaign context (org name, current campaign, day number)
- [ ] Store in stewardship DB alongside org record — **not done**: stored in Clerk metadata for now (see Decisions)

## Status and notes

### Needs keys or a live check before this works end to end
- **Clerk:** `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Set the production domain and the `/studio` sign-in and sign-up paths in the Clerk dashboard. Only checked with a fake key: protected pages redirect to login and API routes return 401. Real sign-in, sign-out and session handling are untested.
- **Zernio:** `ZERNIO_API_KEY` is already set. Not yet checked against a live account: the profile create response, the connect select steps, post edit and delete, and whether post objects carry `profileId`. The ownership check falls back to account IDs if they don't.
- **Ideogram:** `IDEOGRAM_API_KEY`. The endpoint, request body and response path in `src/lib/studio/ideogram.ts` are unverified.

### Decisions (change any of these)
- Org settings live in Clerk privateMetadata, not the stewardship DB. The stewardship DB would need a Postgres connection from Vercel, and it has no org record for these fields.
- The Clerk Astro integration is not used. Its server build needs two Vite externals, which `astro.config.mjs` sets directly.
- Each Clerk user gets one Zernio profile named "Studio client", with `externalId` set to the Clerk user ID.
- The Instagram caption is also used for Facebook and YouTube. The LinkedIn caption is also used for X. The old `firstComment` promo line is not carried over.
- The graphic step asks Ideogram for 2 images. Posting a graphic replaces the video in that post.

### Overlap with client-dashboard
`client-dashboard/` (Express on Fly, magic-link login from `fly-service/users.json`) already has calendar, account connect, post creation, media upload and analytics against Zernio. Studio duplicates those on a second login system. Decide whether one replaces the other before more work goes into either.

### Known gaps
- Facebook and LinkedIn: no page or profile picker. The production dashboard also completes the select step without a selection, so Zernio picks.
- The calendar shows the first 100 posts. No pagination.
- If Zernio can't be reached on a user's first Studio visit, the page shows Astro's error page instead of a message.
- `/api/content/start` and `/api/content/result` have no auth. That predates Studio, and Studio calls them.
- Zernio base URL is `https://zernio.com/api/v1` (override with `ZERNIO_BASE_URL`). `src/pages/api/content/accounts.ts` defaults to `https://api.zernio.com/v1`, a different host. Left alone.

### Environment variables added
- `PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — Clerk
- `IDEOGRAM_API_KEY` — graphics
- `ZERNIO_BASE_URL` — optional override

Tests: `npm test` runs the rule-level checks (ownership, scheduling, settings, URL and caption validation).

## Zernio API notes
- Base URL: `https://zernio.com/api/v1`
- Auth: `Authorization: Bearer $ZERNIO_API_KEY`
- Key resource groups: Profiles (5 endpoints), Accounts (19), Connect (58), Posts (10), Analytics (29)
- Multi-tenant: each client = one profile, scoped API keys supported
- MCP server at `https://mcp.zernio.com/mcp` (OAuth 2.1) — not connected yet, not blocking

## Client onboarding (/signup) — SHIPPED

`attentionearned.com/signup` — multi-step form, Zernio OAuth connect, auto-commit to users.json, welcome SMS.

### Required Vercel env vars (add in Vercel dashboard > attentionearned > Settings > Environment Variables):
- `ZERNIO_API_KEY` — same value as the Fly secret on text-to-attention
- `ZERNIO_PROFILE_ID` — `68dad1bfe2de3b9d7f99ae26` (David's master profile)
- `GITHUB_TOKEN` — GitHub PAT with `repo` scope (create at github.com/settings/tokens)
- `TWILIO_ACCOUNT_SID` — same as Fly
- `TWILIO_AUTH_TOKEN` — same as Fly
- `TWILIO_FROM_NUMBER` — `+18666188109`

### How it works:
1. Client fills out name/org/email/phone/timezone
2. We snapshot current Zernio account IDs (baseline)
3. Client connects each platform via Zernio OAuth (full-page redirect, comes back to /signup?step=2&connected=PLATFORM)
4. On Finish: POST /api/onboard/provision → finds new accounts (not in baseline) → commits users.json to GitHub → Fly deploy auto-triggers → welcome SMS sent

## Open questions
- Pricing/billing for public lead gen tier (free trial? paid?)
- Ideogram API key — need to get one
- Whether to link stewardship orgs to Clerk orgs 1:1
- Should Studio replace `client-dashboard/`, or sit beside it? (See Overlap above.)
