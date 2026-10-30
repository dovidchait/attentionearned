/**
 * All Zernio calls happen server-side here — the API key never reaches the browser.
 * Each route resolves the caller's user → their Zernio API key → proxies the call.
 */
import { Router } from 'express';
import { findUserByEmail, apiKeyFor, isAdmin, allUsers } from '../lib/users.js';
import * as Z from '../lib/zernio.js';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveUser(req) {
  // Admins can pass ?asClient=email to view another client's data
  if (isAdmin(req.userEmail) && req.query.asClient) {
    const client = findUserByEmail(req.query.asClient);
    if (client) return client;
  }
  return findUserByEmail(req.userEmail);
}

function handle(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, code: err.code });
    }
  };
}

// ─── Posts ──────────────────────────────────────────────────────────────────

router.get('/posts', handle(async req => {
  const user = resolveUser(req);
  const key = apiKeyFor(user);
  const { status, limit, page } = req.query;
  const data = await Z.listPosts(key, {
    profileId: user.zernioProfileId,
    status, limit, page,
  });
  return data;
}));

router.get('/posts/:id', handle(async req => {
  const user = resolveUser(req);
  return Z.getPost(req.params.id, apiKeyFor(user));
}));

router.put('/posts/:id', handle(async req => {
  const user = resolveUser(req);
  return Z.updatePost(req.params.id, req.body, apiKeyFor(user));
}));

router.delete('/posts/:id', handle(async req => {
  const user = resolveUser(req);
  await Z.deletePost(req.params.id, apiKeyFor(user));
  return { ok: true };
}));

router.post('/posts/:id/publish', handle(async req => {
  const user = resolveUser(req);
  return Z.publishPostNow(req.params.id, apiKeyFor(user));
}));

router.post('/posts', handle(async req => {
  const user = resolveUser(req);
  const { _idempotencyKey, ...body } = req.body;
  return Z.createPost({ profileId: user.zernioProfileId, ...body }, apiKeyFor(user), _idempotencyKey || undefined);
}));

router.get('/posts/:id/analytics', handle(async req => {
  const user = resolveUser(req);
  return Z.getPostAnalytics(req.params.id, apiKeyFor(user));
}));

// ─── Accounts ───────────────────────────────────────────────────────────────

router.get('/accounts', handle(async req => {
  const user = resolveUser(req);
  return Z.listAccounts(apiKeyFor(user), { profileId: user.zernioProfileId });
}));

router.get('/accounts/:id/analytics', handle(async req => {
  const user = resolveUser(req);
  return Z.getAccountAnalytics(req.params.id, apiKeyFor(user), {
    period: req.query.period,
  });
}));

// Returns the Zernio OAuth URL — browser follows it directly.
// API key NOT included in the returned URL; Zernio's connect flow is authenticated
// on their end via the profileId.
router.get('/accounts/connect-url', handle(async req => {
  const user = resolveUser(req);
  const { platform } = req.query;
  if (!platform) return { error: 'platform is required' };
  const base = process.env.DASHBOARD_URL || 'http://localhost:4000';
  const redirectUrl = `${base}/accounts/callback?platform=${encodeURIComponent(platform)}`;
  const url = Z.getConnectUrl(platform, user.zernioProfileId, redirectUrl, apiKeyFor(user));
  return { connectUrl: url };
}));

router.post('/accounts/connect-complete', handle(async req => {
  const user = resolveUser(req);
  const { platform, step, connectToken, selectionId } = req.body;
  if (!platform || !step || !connectToken) {
    const err = new Error('platform, step, and connectToken are required');
    err.status = 400;
    throw err;
  }
  return Z.completeConnectStep(platform, step, {
    connectToken, profileId: user.zernioProfileId,
    ...(selectionId ? { selectionId } : {}),
  }, apiKeyFor(user));
}));

// ─── Media ──────────────────────────────────────────────────────────────────

router.get('/media', handle(async req => {
  const user = resolveUser(req);
  return Z.listMedia(apiKeyFor(user), {
    profileId: user.zernioProfileId,
    limit: req.query.limit,
    page: req.query.page,
  });
}));

router.post('/media/presign', handle(async req => {
  const user = resolveUser(req);
  const { filename, contentType, size } = req.body;
  if (!filename || !contentType || !size) {
    const err = new Error('filename, contentType, and size are required');
    err.status = 400;
    throw err;
  }
  return Z.presignUpload(filename, contentType, size, apiKeyFor(user));
}));

// ─── Admin ──────────────────────────────────────────────────────────────────

router.get('/admin/clients', handle(async req => {
  if (!isAdmin(req.userEmail)) {
    const err = new Error('Forbidden'); err.status = 403; throw err;
  }
  return { clients: allUsers().map(u => ({ name: u.name, email: u.email, timezone: u.timezone })) };
}));

export default router;
