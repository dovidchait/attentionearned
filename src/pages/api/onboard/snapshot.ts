export const prerender = false;
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const apiKey = import.meta.env.ZERNIO_API_KEY;
  const profileId = import.meta.env.ZERNIO_PROFILE_ID;

  if (!apiKey || !profileId) {
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(
      `https://zernio.com/api/v1/accounts?profileId=${encodeURIComponent(profileId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({ error: `Zernio ${res.status}: ${body.slice(0, 200)}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const data = await res.json();
    const accounts: any[] = data.accounts || data.data || (Array.isArray(data) ? data : []);
    const ids: string[] = accounts.map((a) => a._id || a.id).filter(Boolean);
    return new Response(JSON.stringify({ accountIds: ids, profileId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
