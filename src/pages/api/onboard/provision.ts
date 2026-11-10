export const prerender = false;
import type { APIRoute } from 'astro';

function normalizePhone(val: string): string {
  return val.replace(/[^\d+]/g, '');
}

function slugify(val: string): string {
  return val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function getZernioAccounts(apiKey: string, profileId: string): Promise<any[]> {
  const res = await fetch(
    `https://zernio.com/api/v1/accounts?profileId=${encodeURIComponent(profileId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) throw new Error(`Zernio ${res.status}`);
  const data = await res.json();
  return data.accounts || data.data || (Array.isArray(data) ? data : []);
}

async function commitToGitHub(
  token: string,
  owner: string,
  repo: string,
  path: string,
  newContent: string,
  message: string
): Promise<void> {
  // Get current file (need SHA for update)
  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AttentionEarned-Onboard/1.0',
      },
    }
  );
  if (!getRes.ok) throw new Error(`GitHub GET ${getRes.status}: ${await getRes.text()}`);
  const fileData = await getRes.json();

  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'AttentionEarned-Onboard/1.0',
      },
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(newContent))),
        sha: fileData.sha,
        branch: 'main',
      }),
    }
  );
  if (!putRes.ok) throw new Error(`GitHub PUT ${putRes.status}: ${await putRes.text()}`);
}

async function sendWelcomeSMS(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  toNumber: string,
  orgName: string
): Promise<void> {
  const body =
    `Attention Earned: you're all set, ${orgName}! Text a photo or video here to post it to your accounts. Reply HELP for help or STOP to opt out.`;
  const params = new URLSearchParams({ From: fromNumber, To: toNumber, Body: body });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Twilio SMS failed ${res.status}: ${text}`);
    // Non-fatal: don't throw, just log
  }
}

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { name, orgName, email, phone, timezone, baseline } = body;

  if (!name || !email) {
    return new Response(JSON.stringify({ error: 'name and email are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const emailLower = email.toLowerCase().trim();
  const baselineIds: Set<string> = new Set(Array.isArray(baseline) ? baseline : []);

  const apiKey = import.meta.env.ZERNIO_API_KEY;
  const profileId = import.meta.env.ZERNIO_PROFILE_ID;
  const githubToken = import.meta.env.GITHUB_TOKEN;
  const twilioSid = import.meta.env.TWILIO_ACCOUNT_SID;
  const twilioToken = import.meta.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = import.meta.env.TWILIO_FROM_NUMBER || '+18666188109';

  if (!apiKey || !profileId) {
    return new Response(JSON.stringify({ error: 'Zernio not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Find accounts connected during this session (not in the pre-session baseline)
    const allAccounts = await getZernioAccounts(apiKey, profileId);
    const newAccounts = allAccounts.filter(
      (a) => !baselineIds.has(a._id || a.id)
    );

    const userEntry: Record<string, any> = {
      name: name.trim(),
      orgName: (orgName || name).trim(),
      email: emailLower,
      emails: [],
      timezone: timezone || 'America/New_York',
      apiKeyEnv: 'ZERNIO_API_KEY',
      zernioProfileId: profileId,
      accounts: newAccounts.map((a: any) => ({
        accountId: a._id || a.id,
        platform: a.platform,
        label: `${a.platform} @${a.username || a.name || a.accountName || 'account'}`,
      })),
    };

    if (phone) {
      const normalized = normalizePhone(phone.trim());
      if (normalized) {
        userEntry.phone = normalized;
        userEntry.whatsapp = normalized;
      }
    }

    if (!githubToken) {
      // No GitHub token — return the entry for manual provisioning
      return new Response(
        JSON.stringify({
          status: 'pending_manual',
          message: 'No GitHub token configured — add this entry to users.json manually.',
          entry: userEntry,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read current users.json
    const getRes = await fetch(
      'https://api.github.com/repos/dovidchait/attentionearned/contents/fly-service/users.json',
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AttentionEarned-Onboard/1.0',
        },
      }
    );
    if (!getRes.ok) throw new Error(`GitHub GET users.json: ${getRes.status}`);
    const fileData = await getRes.json();
    const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
    const usersConfig = JSON.parse(decoded);

    // Idempotency: skip if email already exists
    const alreadyExists = (usersConfig.users || []).some(
      (u: any) => u.email?.toLowerCase() === emailLower
    );
    if (alreadyExists) {
      return new Response(
        JSON.stringify({ status: 'already_exists', message: 'Email already provisioned.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    usersConfig.users.push(userEntry);
    const newJson = JSON.stringify(usersConfig, null, 2) + '\n';

    const putRes = await fetch(
      'https://api.github.com/repos/dovidchait/attentionearned/contents/fly-service/users.json',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'AttentionEarned-Onboard/1.0',
        },
        body: JSON.stringify({
          message: `Add client: ${userEntry.orgName}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_016e5gYZwteWHj7CCof9kGkL`,
          content: btoa(unescape(encodeURIComponent(newJson))),
          sha: fileData.sha,
          branch: 'main',
        }),
      }
    );
    if (!putRes.ok) {
      const errBody = await putRes.text();
      throw new Error(`GitHub commit failed ${putRes.status}: ${errBody}`);
    }

    // Welcome SMS (non-fatal if it fails)
    if (userEntry.phone && twilioSid && twilioToken) {
      await sendWelcomeSMS(
        twilioSid,
        twilioToken,
        twilioFrom,
        userEntry.phone,
        userEntry.orgName
      );
    }

    return new Response(
      JSON.stringify({
        status: 'ok',
        message: `${userEntry.orgName} provisioned. Fly deploy triggered — live in ~2 minutes.`,
        accounts: userEntry.accounts.length,
        sms: Boolean(userEntry.phone && twilioSid),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Provision error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
