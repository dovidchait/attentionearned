import { Router } from 'express';
import { findUserByEmail } from '../lib/users.js';
import {
  createMagicToken, verifyMagicToken,
  createSessionToken, setSessionCookie, clearSessionCookie,
} from '../lib/auth.js';
import { sendMagicLink } from '../lib/email.js';
import { loginPage } from '../views/pages.js';

const router = Router();

router.get('/login', (req, res) => {
  res.send(loginPage({ sent: !!req.query.sent, error: req.query.error }));
});

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.redirect('/auth/login?error=email_required');

  const user = findUserByEmail(email);
  if (!user) return res.redirect('/auth/login?error=not_found');

  try {
    const token = await createMagicToken(email);
    const base = process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/auth/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLink(email, link);
  } catch (err) {
    console.error('Magic link error:', err.message);
    // Still redirect to "sent" — don't reveal whether the address exists
  }

  res.redirect('/auth/login?sent=1');
});

router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/auth/login?error=invalid');

  try {
    const email = await verifyMagicToken(String(token));
    const sessionToken = await createSessionToken(email);
    setSessionCookie(res, sessionToken);
    res.redirect('/');
  } catch {
    res.redirect('/auth/login?error=expired');
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/auth/login');
});

export default router;
