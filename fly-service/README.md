# fly-service: Text to Attention

WhatsApp, email (or, once the toll-free number is verified, text) a photo or video in, and it posts to your socials through
[Zernio](https://zernio.com) (formerly Late.dev). You get a reply on the same channel
with the live link for each platform, and which ones failed and why.

It also runs the Google Calendar reminder texts (every 5 minutes).

## How it works

```
Twilio SMS/MMS  ─┐
Twilio WhatsApp ─┼─> lib/channels.js ─> lib/poster.js ─> Zernio POST /posts
Emailit inbound ─┘   (parse, verify,     (user, targets,      │
                      reply)              upload, post)       v
         <──────── "where it went" reply <── per-platform status + platformPostUrl
```

- `index.js` routes and the calendar cron
- `lib/channels.js` one object per channel (verify, parse, ack, send, downloadMedia). Adding Meta's WhatsApp Cloud API later is one more object here.
- `lib/poster.js` the channel-agnostic pipeline, STOP/HELP, and the Zernio webhook
- `lib/notify.js` every outbound message: "Attention Earned:" prefix, opt-outs, WhatsApp's 24-hour rule and fallbacks
- `lib/links.js` Dropbox / Google Drive / direct file links used as the media
- `lib/store.js` opt-outs and last-message times (a small JSON file, see "Keep opt-outs")
- `lib/emailit.js` Emailit: send (`POST /v2/emails`), the signed inbound webhook, fetching received mail
- `test/` unit tests with a fake Twilio, fake Zernio and fake Emailit (`npm test`)
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

| `HELP` | short help with editors@attentionearned.com and 347-361-0822 |
| `STOP` / `START` | stop all messages on that channel / turn them back on |

A Dropbox or Google Drive link (shared as "anyone with the link") or a direct `.mp4`/`.mov`/`.jpg` link in
the message is used as the media, so big videos don't need to be attached. WhatsApp only passes files
up to 16 MB; anything bigger gets a reply asking for a link. Email takes attachments as big as the
client's mail provider allows (Gmail and Outlook: about 20-25 MB).

Every message the service sends starts with "Attention Earned:", matching the toll-free verification samples.

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
`TWILIO_AUTH_TOKEN`. WhatsApp needs `TWILIO_WHATSAPP_FROM` (and `TWILIO_WA_TEMPLATE_POSTED_SID` for
links that arrive after 24 h). Email needs `EMAILIT_API_KEY` (Full Access), `EMAILIT_WEBHOOK_SECRET`, `EMAIL_FROM`
and `EMAIL_REPLY_TO`. SMS is off until `SMS_ENABLED=true` (with `TWILIO_FROM_NUMBER`).
`LATE_API_KEY` is no longer used. `GET /` shows which of these are set (true/false, never values).

## WhatsApp (Twilio WhatsApp sender)

No toll-free verification is needed for WhatsApp. Clients message the WhatsApp number, the service
answers "Attention Earned: Got it. Posting now: ...", then sends the live links (or what failed and why)
on WhatsApp.

**WhatsApp's 24-hour rule.** Free-form replies are only allowed within 24 hours of the person's last
WhatsApp message. Posts made "now" always report inside that window. A scheduled post that goes live
later is sent as an approved template, one message per live link. If the template isn't set up yet, or
something failed (a template can't carry the reason), the full report goes by email to the user's
address in `users.json`, then by SMS only if `SMS_ENABLED=true`. Each fallback is logged.

### 1. Test today with the Twilio WhatsApp Sandbox

1. Twilio Console > Messaging > Try it out > Send a WhatsApp message. From your WhatsApp, send
   `join <your-code>` to **+1 415 523 8886**.
2. On that page's Sandbox settings, set "When a message comes in" to
   `https://text-to-attention.fly.dev/whatsapp-webhook` (HTTP POST) and save.
3. `fly secrets set -a text-to-attention TWILIO_WHATSAPP_FROM=+14155238886`
4. WhatsApp a short video with a caption to the sandbox number. You should get "Got it" and then the links.

(The sandbox can't use your own template, so only test inside 24 hours.)

### 2. Register the real WhatsApp sender

1. Twilio Console > Messaging > Senders > WhatsApp senders > Create new sender, pick the number.
   - It can't be a number that already has WhatsApp on a phone (so not 347-361-0822 if that's on WhatsApp).
   - The toll-free **+1 866-618-8109** works if it can receive Meta's verification code by SMS or
     voice call. Twilio shows the code in the console for Twilio numbers. If the code doesn't show,
     temporarily point the number's voice/SMS webhook somewhere you can read (e.g. a TwiML Bin or Studio
     flow that records it), then put the webhooks back.
2. Log in with Facebook when asked and connect (or create) the **Meta Business account** for Attention
   Earned. Display name: **Attention Earned**.
3. In the sender's settings set "Webhook URL for incoming messages" to
   `https://text-to-attention.fly.dev/whatsapp-webhook` (POST). (The app is `text-to-attention` in
   `fly.toml`, so the host is `text-to-attention.fly.dev`.)
4. Once Meta approves it: `fly secrets set -a text-to-attention TWILIO_WHATSAPP_FROM=+18666188109`

### 3. Submit the "post is live" template

Twilio Console > Messaging > Content Template Builder > Create new:

- Name: `post_live` · Language: English · Content type: **Text**
- Body (paste exactly):

  `Attention Earned: your post {{1}} is live here: {{2}}. Reply HELP for help or STOP to opt out.`

- Variable samples: `{{1}}` = `"Gala thank-you" on IG @attentionearned`, `{{2}}` = `https://www.instagram.com/p/DQx2abc`
- Submit for WhatsApp approval, category **Utility**.

When it shows Approved, copy its Content SID (starts with `HX`) and run
`fly secrets set -a text-to-attention TWILIO_WA_TEMPLATE_POSTED_SID=HX...`

Meta rejects templates that start or end with a variable, so the text around `{{2}}` matters.

### Opt-out on WhatsApp

WhatsApp has no carrier STOP handling, so the service does it: `STOP` saves the opt-out and confirms
once; after that nothing is posted or sent to that number until it sends `START`. On SMS, Twilio's own
Opt-Out Management sends the STOP/START/HELP replies; the service only records them.

## Email (Emailit in and out)

Clients email a video (attachment, or a Dropbox/Drive link for big files) with the caption in the body
(or the subject). The service emails back "Got it", then the live links, as replies in the same thread
(`Re: <their subject>`, `In-Reply-To`/`References`). Only addresses in `users.json` get replies. If the
receiving server recorded SPF/DKIM/DMARC results (`Authentication-Results`) and they fail, the mail is
refused, so nobody can post by faking a client's From address. Quoted text under a reply is ignored,
so "STOP" as a reply works.

Emailit receives mail for one subdomain of a verified domain: `anything@inbound.attentionearned.com`.
Your normal mail (Google Workspace on `attentionearned.com`) is not touched.

1. Emailit > Email API > Domains: `attentionearned.com` must be **verified** (it's the From domain).
   On its DNS Setup tab, add the optional inbound record at your DNS provider:
   `MX  inbound  inbound.emailitmail.com  priority 10`. Click Check DNS until it says OK.
2. Emailit > API keys: the key in `EMAILIT_API_KEY` must have **Full Access** (a Sending Only key can
   send but can't read received mail). Older keys without the `secret_` prefix still work.
3. Emailit > Email API > Webhooks > Add webhook: URL `https://text-to-attention.fly.dev/email-webhook`.
   Copy the secret (`whsec_...`, shown once). In its Settings turn off All events and tick only
   `email.received`.
4. `fly secrets set -a text-to-attention EMAILIT_WEBHOOK_SECRET=whsec_... EMAIL_FROM="Attention Earned <post@attentionearned.com>" EMAIL_REPLY_TO=post@inbound.attentionearned.com`
   (and `EMAILIT_API_KEY=...` if it isn't set already).
5. Give clients `post@inbound.attentionearned.com`. Prefer a shorter address? In Google Workspace make
   `post@attentionearned.com` a group or alias that forwards to `post@inbound.attentionearned.com`.
   (If forwarding ever breaks the SPF/DKIM check, the log says "Email rejected: ..."; set
   `EMAIL_REQUIRE_AUTH=false` or have clients use the inbound address directly.)
6. Test: email a short video from an address in `users.json` to `post@inbound.attentionearned.com`. It
   shows on Emailit's Incoming tab within seconds, and you get "Got it" back.

Replies are sent From `EMAIL_FROM` with Reply-To `EMAIL_REPLY_TO`, so a client's reply comes back into
Emailit. Each received email costs 1 Emailit credit, each reply 1 credit.

Other forwarders (a Cloudflare Email Worker, etc.) can post a raw email (`Content-Type: message/rfc822`)
or simple JSON (`from`, `subject`, `text`, `attachments[]`) to `/email-webhook?secret=<EMAIL_WEBHOOK_SECRET>`;
without that secret set, only signed Emailit requests are accepted.

## Keep opt-outs across deploys

STOP opt-outs and WhatsApp last-message times are saved in `state.json`. Without a volume that file
is wiped on each deploy (the 24-hour check then falls back to the time saved on the post itself, but
opt-outs are lost). To keep them:

```bash
fly volumes create tta_data --region iad --size 1 -a text-to-attention
# then uncomment the [mounts] block at the bottom of fly.toml and deploy
```

## Deploy (Fly.io, app `text-to-attention`)

```bash
cd fly-service
fly status -a text-to-attention          # is the app/machine there and running?

fly secrets set -a text-to-attention \
  ZERNIO_API_KEY=... \
  TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... \
  TWILIO_WHATSAPP_FROM=+1... TWILIO_WA_TEMPLATE_POSTED_SID=HX... \
  EMAILIT_API_KEY=... EMAILIT_WEBHOOK_SECRET=whsec_... \
  EMAIL_FROM="Attention Earned <post@attentionearned.com>" EMAIL_REPLY_TO=post@inbound.attentionearned.com
# later, once the toll-free number is verified:
# fly secrets set -a text-to-attention SMS_ENABLED=true TWILIO_FROM_NUMBER=+18666188109

fly secrets unset -a text-to-attention LATE_API_KEY   # if it was set

fly deploy                                # builds from this folder's Dockerfile
fly machine start -a text-to-attention    # only if the machine is stopped
curl https://text-to-attention.fly.dev/   # should say "posting": "zernio"
```

Twilio console: WhatsApp sender webhook `https://text-to-attention.fly.dev/whatsapp-webhook`; on the
number (once SMS is on) Messaging webhook `https://text-to-attention.fly.dev/sms-webhook` (both POST).
Emailit webhook (event `email.received`): `https://text-to-attention.fly.dev/email-webhook`.

Optional, for live links on scheduled/queued posts: in Zernio create a webhook for
`post.published`, `post.partial`, `post.failed` pointing at
`https://text-to-attention.fly.dev/zernio-webhook`, then
`fly secrets set ZERNIO_WEBHOOK_SECRET=<its secret>`.

## Local dev

```bash
cp .env.example .env   # fill in; .env is git-ignored
npm install
npm test               # fake Twilio, Zernio and Emailit on localhost; no real network
node --env-file=.env index.js
```

Set `ZERNIO_BASE_URL` to point at a mock server for testing without posting.

## Known limits

- WhatsApp: free-form replies only within 24 h of the person's last message (template or email after
  that, see above). Media up to 16 MB; bigger videos need a link.
- Videos from links are held in memory while uploading (512 MB machine); `MAX_LINK_MEDIA_MB` (default
  250) caps them.
- Queue mode uses the user's `zernioProfileId`. AttentionEarned's IG and LinkedIn live in a
  second Zernio profile, so for them prefer posting now or scheduling.
