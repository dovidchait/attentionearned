# Studio / Content Engine — Build Plan

## What we're building
A DIY content creation and distribution tool for small NPOs and small businesses,
hosted at attentionearned.com/studio. Public lead gen + internal client tool.
No AI video. User uploads their own footage.

## What already exists
- `src/pages/api/content/start.ts` — submit video URL to AssemblyAI for transcription
- `src/pages/api/content/result.ts` — poll transcript, generate Instagram/LinkedIn captions via Claude Haiku
- `src/pages/api/content/accounts.ts` — fetch connected social accounts from Zernio
- `src/pages/api/content/post.ts` — schedule/post video to social platforms via Zernio
- `fly-service/index.js` — SMS/WhatsApp/email-triggered posting via Twilio + Late.dev
- `stewardship/` — org/donor/campaign DB (Postgres + Drizzle) — reuse for org settings

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
- [ ] `/studio` — public marketing page explaining the tool
- [ ] CTA → sign up / log in

### 2. Auth
- [ ] Install and configure Clerk for Astro
- [ ] `/studio/login` and `/studio/signup` pages
- [ ] Middleware to protect `/studio/dashboard` and `/studio/create`

### 3. Zernio profile provisioning
- [ ] On first login: `POST /v1/profiles` with Clerk user ID as `externalId`
- [ ] Store returned `profile._id` (in stewardship DB or Clerk metadata)
- [ ] Skip if profile already exists

### 4. Social account connect flow
- [ ] "Connect accounts" page — list connected accounts, add new
- [ ] `GET /connect/{platform}?profileId=...&redirect_url=...` → redirect user
- [ ] Callback handler — pass `connect_token` + `step` to Zernio select endpoint
- [ ] Per-platform select steps (Facebook → select_page, etc.)
- [ ] Branded screens already configured in Zernio white-label settings

### 5. Content creation UI
- [ ] `/studio/create` — main creation flow
- [ ] Step 1: Upload video file or paste URL
- [ ] Step 2: Transcribe via AssemblyAI (calls existing `/api/content/start` + `/api/content/result`)
- [ ] Step 3: Review/edit captions (Instagram, LinkedIn, TikTok)
- [ ] Step 4: Generate graphic — describe → Ideogram API → pick image
- [ ] Step 5: Select accounts, pick date/time → schedule via Zernio

### 6. Content calendar
- [ ] `/studio/dashboard` — calendar view of scheduled posts
- [ ] `GET /v1/posts?profileId=...` to pull scheduled/published posts
- [ ] Grid or list view with status (scheduled, published, failed)
- [ ] Click post → edit or reschedule

### 7. Org settings
- [ ] Voice/tone fields (feeds caption prompts)
- [ ] Campaign context (org name, current campaign, day number)
- [ ] Store in stewardship DB alongside org record

## Zernio API notes
- Base URL: `https://zernio.com/api/v1`
- Auth: `Authorization: Bearer $ZERNIO_API_KEY`
- Key resource groups: Profiles (5 endpoints), Accounts (19), Connect (58), Posts (10), Analytics (29)
- Multi-tenant: each client = one profile, scoped API keys supported
- MCP server at `https://mcp.zernio.com/mcp` (OAuth 2.1) — not connected yet, not blocking

## Open questions
- Pricing/billing for public lead gen tier (free trial? paid?)
- Ideogram API key — need to get one
- Whether to link stewardship orgs to Clerk orgs 1:1
