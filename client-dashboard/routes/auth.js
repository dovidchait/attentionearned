import { Router } from 'express';
import { findUserByEmail, addUser } from '../lib/users.js';
import {
  createMagicToken, verifyMagicToken,
  createSessionToken, setSessionCookie, clearSessionCookie,
} from '../lib/auth.js';
import { sendMagicLink, sendSignupNotification } from '../lib/email.js';
import { loginPage, signupPage } from '../views/pages.js';

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

router.get('/signup', (req, res) => {
  res.send(signupPage({ sent: !!req.query.sent, error: req.query.error }));
});

router.post('/signup', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const orgName = (req.body.orgName || '').trim();

  if (!name || !email) return res.redirect('/auth/signup?error=fields_required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/auth/signup?error=invalid_email');

  let user = findUserByEmail(email);
  const isNew = !user;
  if (isNew) user = addUser({ name, email, orgName });

  try {
    const token = await createMagicToken(email);
    const base = process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/auth/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLink(email, link);
    if (isNew) {
      sendSignupNotification({ name: user.name, email, orgName }).catch(e =>
        console.error('Signup notification error:', e.message)
      );
    }
  } catch (err) {
    console.error('Signup error:', err.message);
  }

  res.redirect('/auth/signup?sent=1');
});

export default router;
