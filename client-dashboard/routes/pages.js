/**
 * Server-rendered HTML pages (protected — requireAuth applied in server.js).
 * Each page loads with skeleton UIs; data is fetched client-side via /api/*.
 */
import { Router } from 'express';
import { findUserByEmail, isAdmin, allUsers } from '../lib/users.js';
import * as Z from '../lib/zernio.js';
import {
  calendarPage, publishedPage, accountsPage, newPostPage,
  analyticsPage, mediaPage, adminPage, accountCallbackPage,
} from '../views/pages.js';

const router = Router();

function resolveContext(req) {
  const admin = isAdmin(req.userEmail);
  const asClient = (admin && req.query.asClient) ? req.query.asClient : null;
  const user = asClient ? findUserByEmail(asClient) : findUserByEmail(req.userEmail);
  const brand = {
    name: user?.orgName || user?.name,
    primaryColor: user?.brandColor,
    logoUrl: user?.logoUrl,
  };
  return { user, brand, isAdmin: admin, asClient };
}

router.get('/', (req, res) => {
  const ctx = resolveContext(req);
  res.send(calendarPage(ctx));
});

router.get('/published', (req, res) => {
  const ctx = resolveContext(req);
  res.send(publishedPage(ctx));
});

router.get('/accounts', (req, res) => {
  const ctx = resolveContext(req);
  res.send(accountsPage(ctx));
});

// OAuth callback from Zernio after connecting a social account
router.get('/accounts/callback', async (req, res) => {
  const { platform, connect_token, error } = req.query;
  if (error) {
    return res.send(accountCallbackPage({ platform, connected: false, error }));
  }
  if (!connect_token || !platform) {
    return res.send(accountCallbackPage({ platform, connected: false, error: 'Missing connection token.' }));
  }

  try {
    const user = findUserByEmail(req.userEmail);
    const key = (await import('../lib/users.js')).apiKeyFor(user);

    // Some platforms need a select step; others complete directly
    const NEEDS_SELECT = { facebook: 'select_page', linkedin: 'select_profile' };
    const step = NEEDS_SELECT[platform?.toLowerCase()];

    if (step) {
      await Z.completeConnectStep(platform, step, {
        connectToken: connect_token,
        profileId: user.zernioProfileId,
      }, key);
    }
    // No select step needed — connection is complete

    res.send(accountCallbackPage({ platform, connected: true }));
  } catch (err) {
    res.send(accountCallbackPage({ platform, connected: false, error: err.message }));
  }
});

router.get('/new', (req, res) => {
  const ctx = resolveContext(req);
  res.send(newPostPage(ctx));
});

router.get('/analytics', (req, res) => {
  const ctx = resolveContext(req);
  res.send(analyticsPage(ctx));
});

router.get('/media', (req, res) => {
  const ctx = resolveContext(req);
  res.send(mediaPage(ctx));
});

router.get('/admin', (req, res) => {
  if (!isAdmin(req.userEmail)) return res.redirect('/');
  const user = findUserByEmail(req.userEmail);
  const brand = { name: user?.orgName || user?.name, color: user?.brandColor };
  res.send(adminPage({ brand, isAdmin: true }));
});

export default router;
