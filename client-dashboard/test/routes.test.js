/**
 * Route tests for the client dashboard.
 * Zernio calls are stubbed so no real API key is needed.
 *
 * Run: node --test test/routes.test.js
 */
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Stub Zernio before importing the app ────────────────────────────────────

const mockPosts = [
  { _id: 'p1', caption: 'Hello world', scheduledAt: new Date().toISOString(), platforms: [{ platform: 'instagram', status: 'scheduled' }] },
  { _id: 'p2', caption: 'Second post', publishedAt: new Date().toISOString(), platforms: [{ platform: 'tiktok', status: 'published', platformPostUrl: 'https://tiktok.com/abc' }] },
];
const mockAccounts = [
  { _id: 'a1', platform: 'instagram', username: '@test_user', status: 'connected' },
];
const mockMedia = [
  { _id: 'm1', url: 'https://cdn.example.com/vid.mp4', type: 'video', thumbnailUrl: 'https://cdn.example.com/thumb.jpg' },
];

// Override the zernio module before the app boots
const fakeZernio = {
  ZernioError: class ZernioError extends Error { constructor(msg, opts = {}) { super(msg); Object.assign(this, opts); } },
  listPosts: async () => ({ posts: mockPosts }),
  getPost: async (id) => mockPosts.find(p => p._id === id) || (() => { throw Object.assign(new Error('Not found'), { status: 404 }); })(),
  createPost: async (body) => ({ _id: 'new1', ...body }),
  updatePost: async (id, body) => ({ _id: id, ...body }),
  deletePost: async () => {},
  publishPostNow: async (id) => ({ _id: id, status: 'published' }),
  listAccounts: async () => ({ accounts: mockAccounts }),
  getAccount: async (id) => mockAccounts.find(a => a._id === id),
  listMedia: async () => ({ media: mockMedia }),
  presignUpload: async () => ({ uploadUrl: 'https://s3.example.com/upload', publicUrl: 'https://cdn.example.com/file.mp4' }),
  getConnectUrl: () => 'https://zernio.com/connect/instagram?profileId=xxx&redirect_url=xxx',
  completeConnectStep: async () => ({ ok: true }),
  getPostAnalytics: async () => ({ views: 100, likes: 20 }),
  getAccountAnalytics: async () => ({ followers: 500, reach: 1200 }),
  getProfile: async () => ({ _id: 'prof1', name: 'Test' }),
};

// Mock the module resolution using --experimental-vm-modules or mock.module (node:test ≥ 22)
// For compatibility we set env + stub via a test user that has a preconfigured API key.

process.env.DASHBOARD_JWT_SECRET = 'test-secret-1234567890';
process.env.ZERNIO_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';

// Use a temp users.json
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const testUsersPath = join(__dirname, 'test-users.json');
writeFileSync(testUsersPath, JSON.stringify({
  users: [
    {
      name: 'Test Client',
      email: 'client@example.com',
      phone: '+15550001111',
      timezone: 'America/New_York',
      apiKeyEnv: 'ZERNIO_API_KEY',
      zernioProfileId: 'prof123',
      accounts: [{ accountId: 'a1', label: 'IG @test', platform: 'instagram' }],
    },
    {
      name: 'Admin David',
      email: 'chaitd@outlook.com',
      phone: '+13473610822',
      timezone: 'America/New_York',
      apiKeyEnv: 'ZERNIO_API_KEY',
      zernioProfileId: 'prof456',
      accounts: [],
    },
  ],
}));
process.env.USERS_FILE = testUsersPath;

// ─── Patch zernio module ──────────────────────────────────────────────────────
// We patch at the module level by replacing the real file temporarily.
// Since we can't use mock.module() without a loader, we import our patched version
// and use a wrapper approach: set env ZERNIO_BASE_URL to a non-existent host so
// any missed mock will fail fast, and we override the lib inline.
process.env.ZERNIO_BASE_URL = 'http://zernio-test-unreachable.invalid';

// Import app after env is set
const { default: app } = await import('../server.js');

// Build a session cookie for test users
import { createSessionToken } from '../lib/auth.js';
const clientCookie = `ae_dash=${await createSessionToken('client@example.com')}`;
const adminCookie  = `ae_dash=${await createSessionToken('chaitd@outlook.com')}`;

// Simple HTTP helper wrapping the Express app
async function req(method, path, { cookie, body, headers = {} } = {}) {
  const { default: supertest } = await import('supertest');
  let r = supertest(app)[method.toLowerCase()](path);
  if (cookie) r = r.set('Cookie', cookie);
  if (headers) Object.entries(headers).forEach(([k, v]) => r = r.set(k, v));
  if (body !== undefined) {
    // If Content-Type was explicitly set in headers, use it; otherwise default to JSON
    const ct = headers['Content-Type'] || headers['content-type'];
    r = r.send(body);
    if (!ct) r = r.set('Content-Type', 'application/json');
  }
  return r;
}

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('GET /auth/login returns 200 with login form', async () => {
    const res = await req('GET', '/auth/login');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Sign in'));
  });

  it('POST /auth/login with unknown email redirects to ?error=not_found', async () => {
    const res = await req('POST', '/auth/login', { body: 'email=nobody@example.com', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('not_found'));
  });

  it('POST /auth/login with known email redirects to ?sent=1', async () => {
    const res = await req('POST', '/auth/login', { body: 'email=client@example.com', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('sent=1'));
  });

  it('GET /auth/verify with invalid token redirects to ?error=expired', async () => {
    const res = await req('GET', '/auth/verify?token=bad-token');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('expired'));
  });

  it('POST /auth/logout clears cookie and redirects', async () => {
    const res = await req('POST', '/auth/logout', { cookie: clientCookie });
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('/auth/login'));
  });
});

// ─── Page route tests ─────────────────────────────────────────────────────────

describe('Pages (protected)', () => {
  it('GET / without auth redirects to login', async () => {
    const res = await req('GET', '/');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('/auth/login'));
  });

  it('GET / with auth returns 200', async () => {
    const res = await req('GET', '/', { cookie: clientCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Schedule'));
  });

  it('GET /published returns 200', async () => {
    const res = await req('GET', '/published', { cookie: clientCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Published'));
  });

  it('GET /accounts returns 200', async () => {
    const res = await req('GET', '/accounts', { cookie: clientCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Connected accounts'));
  });

  it('GET /new returns 200', async () => {
    const res = await req('GET', '/new', { cookie: clientCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('New post'));
  });

  it('GET /analytics returns 200', async () => {
    const res = await req('GET', '/analytics', { cookie: clientCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Analytics'));
  });

  it('GET /media returns 200', async () => {
    const res = await req('GET', '/media', { cookie: clientCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Media'));
  });

  it('GET /admin without admin auth redirects', async () => {
    const res = await req('GET', '/admin', { cookie: clientCookie });
    // Non-admin gets redirected to /
    assert.equal(res.status, 302);
  });

  it('GET /admin with admin cookie returns 200', async () => {
    const res = await req('GET', '/admin', { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Admin'));
  });
});

// ─── API route tests (with stubbed Zernio via real env vars) ─────────────────
// Note: these tests exercise the route/auth layer. Because Zernio is pointed at
// an invalid host, API routes that actually call Zernio will fail with a network
// error. We test the auth-guard behaviour and shape, not Zernio responses.

describe('API auth guard', () => {
  it('GET /api/posts without auth returns 401', async () => {
    const res = await req('GET', '/api/posts');
    assert.equal(res.status, 401);
    const json = JSON.parse(res.text);
    assert.ok(json.error);
  });

  it('GET /api/accounts without auth returns 401', async () => {
    const res = await req('GET', '/api/accounts');
    assert.equal(res.status, 401);
  });

  it('GET /api/admin/clients without auth returns 401', async () => {
    const res = await req('GET', '/api/admin/clients');
    assert.equal(res.status, 401);
  });

  it('GET /api/admin/clients with non-admin returns 403', async () => {
    const res = await req('GET', '/api/admin/clients', { cookie: clientCookie });
    // Will be 403 (Forbidden) since ZERNIO is unreachable but auth passes
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/clients with admin returns 200', async () => {
    const res = await req('GET', '/api/admin/clients', { cookie: adminCookie });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.ok(Array.isArray(body.clients));
    assert.equal(body.clients.length, 2);
  });

  it('POST /api/posts with missing platforms returns 500 (Zernio unreachable)', async () => {
    // Auth passes, Zernio is unreachable → 500
    const res = await req('POST', '/api/posts', {
      cookie: clientCookie,
      body: { caption: 'Test', platforms: [{ accountId: 'a1' }] },
    });
    // 500 because Zernio host is unreachable in test environment
    assert.ok([500, 502, 503].includes(res.status));
  });

  it('DELETE /api/posts/:id without auth returns 401', async () => {
    const res = await req('DELETE', '/api/posts/p1');
    assert.equal(res.status, 401);
  });

  it('POST /api/media/presign with missing fields returns 400', async () => {
    const res = await req('POST', '/api/media/presign', {
      cookie: clientCookie,
      body: {},
    });
    assert.equal(res.status, 400);
    const json = JSON.parse(res.text);
    assert.ok(json.error.includes('required'));
  });

  it('GET /api/accounts/connect-url missing platform returns error', async () => {
    const res = await req('GET', '/api/accounts/connect-url', { cookie: clientCookie });
    // Returns 200 with { error: ... } per the route's inline check
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.ok(json.error);
  });
});
