// JSON helpers and the error type shared by Studio routes.

export class StudioApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'StudioApiError';
    this.status = status;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function unauthorized(): Response {
  return json({ error: 'Sign in to use Studio.' }, 401);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof StudioApiError) return json({ error: err.message }, err.status);
  // Log the message only. Request bodies and captions never go to the logs.
  console.error('[studio] unhandled error:', err instanceof Error ? err.message : 'unknown');
  return json({ error: 'Something went wrong. Try again.' }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
