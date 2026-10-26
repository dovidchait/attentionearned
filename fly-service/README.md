# fly-service: Text to Attention

Text, WhatsApp or email a photo or video in, and it posts to your socials through
[Zernio](https://zernio.com) (formerly Late.dev). You get a reply on the same channel
with the live link for each platform, and which ones failed and why.

It also runs the Google Calendar reminder texts (every 5 minutes).

## How it works

```
Twilio SMS/MMS  ─┐
Twilio WhatsApp ─┼─> lib/channels.js ─> lib/poster.js ─> Zernio POST /posts
Email webhook   ─┘   (parse, verify,     (user, targets,      │
                      reply)              upload, post)       v
         <──────── "where it went" reply <── per-platform status + platformPostUrl
```

- `index.js` routes and the calendar cron
- `lib/channels.js` one object per channel (verify, parse, ack, send, downloadMedia). Adding Meta's WhatsApp Cloud API later is one more object here.
- `lib/poster.js` the channel-agnostic pipeline and the Zernio webhook
- `lib/zernio.js` the Zernio client (presigned upload, create post with an Idempotency-Key, get post, polling)
- `lib/commands.js` the command parser and account selection
- `users.json` who can post and to which Zernio accounts (IDs only, never keys)

## Commands (any channel)

| Message | Result |
|---|---|
| just a caption + media | posts now to every default account |
| `Post to instagram, linkedin` | only those platforms (both IGs for "instagram") |
| `Post to instagram business` / `personal` | narrows to that side (business = AttentionEarned) |
| `Post to all` | every default account |
| `Schedule: 2026-11-02 10:00 EST` | scheduled (no zone = the user's timezone) |
| `Post at tomorrow 9am` | scheduled |
| `Add to queue` | next slot in the user's Zernio queue |

Accounts that can't take a post are skipped and named in the reply: Instagram and TikTok need
media, YouTube needs a video, Reddit is off (see `users.json`).

Posts made "now" are published inside the Zernio request; if a platform is still processing
(video), the service checks `GET /posts/{id}` every 15 s for up to 15 minutes, then sends one
reply. Scheduled and queued posts get their live links through `/zernio-webhook`.

## Users

`users.json` holds one entry per person: phone, WhatsApp number, email(s), timezone, and their
Zernio accounts (`accountId` from `GET https://zernio.com/api/v1/accounts`). A client with their
own Zernio account gets `"apiKeyEnv": "ZERNIO_API_KEY_CLIENTNAME"` and that secret on Fly.
Never put a key in this file.

## Environment

See `.env.example`. Required for posting: `ZERNIO_API_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Email replies need `EMAILIT_API_KEY`.
`LATE_API_KEY` is no longer used.

## Deploy (Fly.io, app `text-to-attention`)

```bash
cd fly-service
fly status -a text-to-attention          # is the app/machine there and running?

fly secrets set -a text-to-attention \
  ZERNIO_API_KEY=... \
  TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1...

fly secrets unset -a text-to-attention LATE_API_KEY   # if it was set

fly deploy                                # builds from this folder's Dockerfile
fly machine start -a text-to-attention    # only if the machine is stopped
curl https://text-to-attention.fly.dev/   # should say "posting": "zernio"
```

Twilio console, on the number: Messaging webhook `https://text-to-attention.fly.dev/sms-webhook`,
WhatsApp sender webhook `https://text-to-attention.fly.dev/whatsapp-webhook` (both POST).

Optional, for live links on scheduled/queued posts: in Zernio create a webhook for
`post.published`, `post.partial`, `post.failed` pointing at
`https://text-to-attention.fly.dev/zernio-webhook`, then
`fly secrets set ZERNIO_WEBHOOK_SECRET=<its secret>`.

## Local dev

```bash
cp .env.example .env   # fill in; .env is git-ignored
npm install
node --env-file=.env index.js
```

Set `ZERNIO_BASE_URL` to point at a mock server for testing without posting.

## Known limits

- WhatsApp replies via Twilio are free-form only within 24 h of the person's last message. A
  scheduled post that goes live later than that needs an approved template to report back.
- Queue mode uses the user's `zernioProfileId`. AttentionEarned's IG and LinkedIn live in a
  second Zernio profile, so for them prefer posting now or scheduling.
