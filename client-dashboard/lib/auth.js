import { SignJWT, jwtVerify } from 'jose';

const SESSION_COOKIE = 'ae_dash';

function secret() {
  const val = process.env.DASHBOARD_JWT_SECRET;
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error('DASHBOARD_JWT_SECRET must be set in production');
  }
  return new TextEncoder().encode(val || 'dev-secret-change-in-production');
}

export async function createMagicToken(email) {
  return new SignJWT({ sub: email, purpose: 'magic' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .sign(secret());
}

export async function verifyMagicToken(token) {
  const { payload } = await jwtVerify(token, secret());
  if (payload.purpose !== 'magic') throw new Error('Invalid token purpose');
  return payload.sub;
}

export async function createSessionToken(email) {
  return new SignJWT({ sub: email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret());
}

export async function verifySessionToken(token) {
  const { payload } = await jwtVerify(token, secret());
  return payload.sub;
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Express middleware — redirects unauthenticated requests to /auth/login */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const isApi = req.originalUrl.startsWith('/api/');
  if (!token) {
    if (isApi) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/auth/login');
  }
  verifySessionToken(token)
    .then(email => { req.userEmail = email; next(); })
    .catch(() => {
      if (isApi) return res.status(401).json({ error: 'Unauthorized' });
      res.redirect('/auth/login');
    });
}
