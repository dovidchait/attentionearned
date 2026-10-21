# NPO Video Pipeline — Next Steps

## Blocked / needs you

- [ ] Confirm correct Zernio API base URL — if `zernio.com/api/v1` still fails, set `ZERNIO_API_BASE` in Vercel to the real host (check Late.dev / Zernio docs or your API dashboard)
- [ ] Add credits to Anthropic account at console.anthropic.com — free tier doesn't include API access; $5 covers hundreds of runs
- [ ] Merge PR #25 on GitHub to deploy

## Known issues

- [ ] Zernio account-load error gives a better message now but root cause (API URL) still unconfirmed in prod
- [ ] Free-use counter is localStorage — clears on new browser / private tab. Fine for MVP, swap for a server-side counter if abuse matters later

## V1 — subtitle burn-in

- [ ] FFmpeg subtitle pipeline: transcribe → generate SRT from AssemblyAI word timestamps → burn subtitles onto video with ffmpeg
- [ ] Decide where to run FFmpeg (Vercel won't work — 50MB function limit, no ffmpeg binary): options are a Fly.io worker, a Modal job, or a simple VPS endpoint
- [ ] Output: captioned .mp4 URL that gets passed to Zernio instead of the raw video URL

## V2 ideas (park for now)

- [ ] Email / magic link auth so free-use counter survives across devices
- [ ] Per-org branding in captions (logo watermark, font style)
- [ ] WhatsApp intake: receive video via WhatsApp webhook, kick off pipeline automatically
- [ ] Webhook back to user when Zernio post goes live
