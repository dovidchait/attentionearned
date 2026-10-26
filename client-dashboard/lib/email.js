import fetch from 'node-fetch';

const FROM = process.env.EMAIL_FROM || 'Attention Earned <dashboard@attentionearned.com>';

/**
 * Send a magic-link sign-in email.
 * Supports two backends:
 *   - EmailIt: set EMAILIT_API_KEY
 *   - Generic SMTP-over-HTTP (Mailgun-compatible): set MAILGUN_API_KEY + MAILGUN_DOMAIN
 * In dev (no keys set) the link is printed to stdout.
 */
export async function sendMagicLink(toEmail, link) {
  const subject = 'Sign in to your dashboard';
  const html = buildMagicLinkEmail(link);
  const text = `Sign in to your Attention Earned dashboard:\n\n${link}\n\nThis link expires in 15 minutes.`;

  if (process.env.EMAILIT_API_KEY) {
    return sendViaEmailIt(toEmail, subject, html, text);
  }

  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
    return sendViaMailgun(toEmail, subject, html, text);
  }

  // Dev fallback — no credentials configured
  console.log(`\n🔗  Magic link for ${toEmail}:\n    ${link}\n`);
}

async function sendViaEmailIt(to, subject, html, text) {
  const res = await fetch('https://api.emailit.com/v1/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.EMAILIT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`EmailIt ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendViaMailgun(to, subject, html, text) {
  const domain = process.env.MAILGUN_DOMAIN;
  const form = new URLSearchParams({ from: FROM, to, subject, html, text });
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mailgun ${res.status}: ${body.slice(0, 200)}`);
  }
}

function buildMagicLinkEmail(link) {
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
    <h2 style="margin-bottom:8px">Sign in to your dashboard</h2>
    <p style="color:#555;margin-bottom:24px">Click the button below. This link expires in 15 minutes.</p>
    <a href="${link}" style="background:#FC2C30;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600">Open dashboard</a>
    <p style="margin-top:24px;font-size:13px;color:#888">Or copy this URL:<br><code style="word-break:break-all">${link}</code></p>
    <p style="margin-top:32px;font-size:12px;color:#aaa">If you didn't request this, ignore this email.</p>
  </body></html>`;
}
