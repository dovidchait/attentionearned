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
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://zernio.com/api/v1/profiles', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': email.toLowerCase().trim(),
    },
    body: JSON.stringify({ name: orgName, externalId: email.toLowerCase().trim() }),
  });

  const data = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: data.message || data.error || 'Failed to create profile' }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const profileId = data._id || data.id || data.profileId;
  if (!profileId) {
    return new Response(JSON.stringify({ error: 'No profileId in response' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ profileId }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
