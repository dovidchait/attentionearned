# Client Dashboard

Mobile-first dashboard for Text to Attention clients (Jewish nonprofits / small businesses). Each client logs in with a magic-link email and sees their own Zernio posting dashboard: scheduled posts, published posts, connected accounts, new post creation, analytics, and media library.

All Zernio API calls are server-side — the API key is never sent to the browser.

## Architecture

```
client-dashboard/         ← this service
├── server.js             ← Express entry
├── lib/
│   ├── auth.js           ← JWT magic-link + session cookies
│   ├── email.js          ← email sending (EmailIt or Mailgun)
│   ├── zernio.js         ← Zernio API client (server-side only)
│   └── users.js          ← reads fly-service/users.json
├── routes/
│   ├── auth.js           ← /auth/{login,verify,logout}
│   ├── pages.js          ← server-rendered HTML pages
│   └── api.js            ← /api/* JSON endpoints (Zernio proxy)
├── views/                ← HTML template functions
└── public/               ← CSS + client JS
```

## Local development

```bash
# Install dependencies
cd client-dashboard
npm install

# Create .env from example
cp .env.example .env
# Edit .env — set DASHBOARD_JWT_SECRET at minimum
# Leave EMAILIT_API_KEY blank to print magic links to stdout in dev

# Start
npm run dev
# → http://localhost:4000
```

Magic links are logged to stdout when no email backend is configured, so you can click them directly.

## Adding a client

1. Edit `fly-service/users.json` (shared between fly-service and this dashboard):

```json
{
  "users": [
    {
      "name": "Org Name",
      "email": "director@org.com",
      "emails": [],
      "timezone": "America/New_York",
      "apiKeyEnv": "ZERNIO_API_KEY_ORG",
      "zernioProfileId": "<their Zernio profile _id>",
      "orgName": "Org Name",
      "brandColor": "#2563eb",
      "logoUrl": "https://org.com/logo.png",
      "accounts": [
        { "accountId": "<id from GET /accounts>", "label": "IG @org", "platform": "instagram" }
      ]
    }
  ]
}
```

2. Set their Zernio key as a Fly secret:
   ```bash
   fly secrets set ZERNIO_API_KEY_ORG=<their key> --app ae-client-dashboard
   ```

3. Redeploy: `fly deploy --app ae-client-dashboard`

The client can then log in at `https://dashboard.attentionearned.com` with their email.

## Deployment on Fly.io

### First deploy

```bash
cd client-dashboard
fly launch --name ae-client-dashboard --no-deploy
# Review fly.toml, then:
fly secrets set \
  DASHBOARD_JWT_SECRET=$(openssl rand -hex 32) \
  ZERNIO_API_KEY=<key> \
  EMAILIT_API_KEY=<key> \
  --app ae-client-dashboard

# Copy users.json into the image (baked) — simplest option:
# The Dockerfile copies everything in the directory;
# copy users.json here before deploying:
cp ../fly-service/users.json .

fly deploy --app ae-client-dashboard
```

### Updating users.json

After editing `fly-service/users.json`, copy and redeploy:
```bash
cp ../fly-service/users.json .
fly deploy --app ae-client-dashboard
```

Or mount a Fly volume and set `USERS_FILE=/data/users.json` for zero-downtime updates.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DASHBOARD_JWT_SECRET` | Yes | 32+ char random string — signs session cookies and magic links |
| `ZERNIO_API_KEY` | Yes | Default Zernio key; per-client keys via `apiKeyEnv` in users.json |
| `EMAILIT_API_KEY` | Prod | EmailIt transactional email for magic links |
| `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` | Alt | Mailgun instead of EmailIt |
| `EMAIL_FROM` | No | Sender name/address |
| `DASHBOARD_URL` | No | Public URL for magic links (auto-detected otherwise) |
| `ADMIN_EMAILS` | No | Comma-separated; `chaitd@outlook.com` is always admin |

## Running tests

```bash
npm test
```

Tests use Node's built-in test runner. Zernio is unreachable in tests (pointed at an invalid host) so only the auth layer, route guards, and field validation are exercised.

## Pages

| Page | Route | Notes |
|---|---|---|
| Schedule / calendar | `/` | Scheduled and draft posts, edit/unschedule/delete/post-now |
| Published | `/published` | Published posts with per-platform live links |
| Accounts | `/accounts` | Connected accounts + connect/reconnect flow |
| New post | `/new` | Upload video/image, caption, platform opts, schedule |
| Analytics | `/analytics` | Per-account and per-post analytics |
| Media library | `/media` | All uploaded media; click to copy URL |
| Admin | `/admin` | David only — list all clients, click to view any client's dashboard |

## Skipped features

- **Inbox / WhatsApp inbox** — requires a paid Zernio add-on (`403 INBOX_REQUIRED`). Skipped.
- **Analytics detail** — Zernio returns data at `GET /posts/:id/analytics` and `GET /accounts/:id/analytics`; the exact schema depends on the plan. The analytics page fetches and renders whatever fields Zernio returns.
- **Media analytics** — not exposed by Zernio's API.
