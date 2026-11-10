export const prerender = false;
import type { APIRoute } from 'astro';

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

  const { orgName, email } = body;
  if (!orgName || !email) {
    return new Response(JSON.stringify({ error: 'orgName and email are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = import.meta.env.ZERNIO_API_KEY;
  const githubToken = import.meta.env.GITHUB_TOKEN;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const emailLower = email.toLowerCase().trim();

  // Check if already provisioned before hitting Zernio
  if (githubToken) {
    try {
      const ghRes = await fetch(
        'https://api.github.com/repos/dovidchait/attentionearned/contents/fly-service/users.json',
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AttentionEarned-Onboard/1.0',
          },
        }
      );
      if (ghRes.ok) {
        const fileData = await ghRes.json();
        const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
        const usersConfig = JSON.parse(decoded);
        const exists = (usersConfig.users || []).some(
          (u: any) => u.email?.toLowerCase() === emailLower
        );
        if (exists) {
          return new Response(JSON.stringify({ status: 'already_exists' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    } catch {
      // Non-fatal: proceed to profile creation
    }
  }

  const { idempotencyKey } = body;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch('https://zernio.com/api/v1/profiles', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: orgName, externalId: email.toLowerCase().trim() }),
  });

  const data = await res.json();
  if (!res.ok) {
    // If externalId already exists, look up the existing profile and return it
    const msg: string = data.message || data.error || '';
    const isConflict = res.status === 409 || /already.*(exist|used)|duplicate|conflict/i.test(msg);
    if (isConflict) {
      try {
        const listRes = await fetch(
          `https://zernio.com/api/v1/profiles?externalId=${encodeURIComponent(emailLower)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (listRes.ok) {
          const listData = await listRes.json();
          const profiles = listData.profiles || listData.data || (Array.isArray(listData) ? listData : []);
          const match = profiles.find((p: any) => p.externalId === emailLower);
          const existingId = match?._id || match?.id;
          if (existingId) {
            return new Response(JSON.stringify({ profileId: existingId }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      } catch {
        // fall through to error
      }
    }
    return new Response(JSON.stringify({ error: msg || 'Failed to create profile' }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const profileId = data._id || data.id || data.profileId || data.profile?._id || data.profile?.id;
  if (!profileId) {
    return new Response(JSON.stringify({ error: 'No profileId in response', keys: Object.keys(data) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ profileId }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
