import { layout, escHtml } from './layout.js';

// ─── Login ───────────────────────────────────────────────────────────────────

export function loginPage({ sent = false, error = null } = {}) {
  const errors = {
    email_required: 'Please enter your email address.',
    not_found: 'This email is not registered. Contact your account manager.',
    expired: 'That link has expired. Request a new one.',
    invalid: 'Invalid sign-in link. Request a new one.',
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Sign in — Attention Earned</title>
  <link rel="stylesheet" href="/style.css"/>
</head>
<body class="auth-body">
  <div class="auth-card">
    <img src="/logo.svg" alt="Attention Earned" class="auth-logo" onerror="this.style.display='none'"/>
    <h1 class="auth-title">Sign in to your dashboard</h1>
    ${sent ? `
      <div class="auth-sent">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="var(--ok)" stroke-width="1.5"/><path d="M8 12l3 3 5-5" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>Check your email for a sign-in link. It expires in 15 minutes.</p>
      </div>
      <a href="/auth/login" class="auth-again">Send another link</a>
    ` : `
      ${error ? `<p class="auth-error">${escHtml(errors[error] || 'Something went wrong.')}</p>` : ''}
      <form action="/auth/login" method="post" class="auth-form">
        <label for="email" class="auth-label">Email address</label>
        <input type="email" id="email" name="email" class="auth-input" required autocomplete="email" placeholder="you@example.com"/>
        <button type="submit" class="auth-btn">Send sign-in link</button>
      </form>
    `}
  </div>
</body>
</html>`;
}

// ─── Calendar (Scheduled posts) ──────────────────────────────────────────────

export function calendarPage({ user, brand, isAdmin, asClient }) {
  return layout({
    title: 'Schedule',
    activePage: 'calendar',
    brand, isAdmin, asClient,
    children: `
<div class="page-header">
  <h1 class="page-title">Schedule</h1>
  <a href="/new" class="btn btn--primary">+ New post</a>
</div>

<div class="filter-bar">
  <button class="filter-chip filter-chip--active" data-status="">All</button>
  <button class="filter-chip" data-status="scheduled">Scheduled</button>
  <button class="filter-chip" data-status="draft">Drafts</button>
</div>

<div id="posts-list" class="posts-list" aria-live="polite">
  <div class="loading-skeleton">
    ${Array(4).fill('<div class="skeleton-card"></div>').join('')}
  </div>
</div>

<!-- Edit modal -->
<dialog id="edit-modal" class="modal" aria-labelledby="edit-modal-title">
  <div class="modal-inner">
    <div class="modal-header">
      <h2 id="edit-modal-title" class="modal-title">Edit post</h2>
      <button class="modal-close" aria-label="Close" onclick="document.getElementById('edit-modal').close()">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
      </button>
    </div>
    <form id="edit-form">
      <input type="hidden" id="edit-post-id"/>
      <div class="form-group">
        <label class="form-label" for="edit-caption">Caption</label>
        <textarea id="edit-caption" class="form-textarea" rows="4"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-time">Scheduled time</label>
        <input type="datetime-local" id="edit-time" class="form-input"/>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--ghost" id="edit-unschedule">Move to drafts</button>
        <button type="button" class="btn btn--danger" id="edit-delete">Delete</button>
        <button type="button" class="btn btn--accent" id="edit-postnow">Post now</button>
        <button type="submit" class="btn btn--primary">Save</button>
      </div>
    </form>
  </div>
</dialog>`,
  });
}

// ─── Published ───────────────────────────────────────────────────────────────

export function publishedPage({ user, brand, isAdmin, asClient }) {
  return layout({
    title: 'Published',
    activePage: 'published',
    brand, isAdmin, asClient,
    children: `
<div class="page-header">
  <h1 class="page-title">Published</h1>
</div>

<div class="filter-bar">
  <button class="filter-chip filter-chip--active" data-status="published">Published</button>
  <button class="filter-chip" data-status="partial">Partial</button>
  <button class="filter-chip" data-status="failed">Failed</button>
</div>

<div id="posts-list" class="posts-list" aria-live="polite">
  <div class="loading-skeleton">${Array(4).fill('<div class="skeleton-card"></div>').join('')}</div>
</div>`,
  });
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export function accountsPage({ user, brand, isAdmin, asClient }) {
  const platforms = ['instagram', 'youtube', 'tiktok', 'linkedin', 'facebook', 'twitter'];
  return layout({
    title: 'Accounts',
    activePage: 'accounts',
    brand, isAdmin, asClient,
    children: `
<div class="page-header">
  <h1 class="page-title">Connected accounts</h1>
</div>

<div id="accounts-list" class="accounts-list" aria-live="polite">
  <div class="loading-skeleton">${Array(3).fill('<div class="skeleton-card skeleton-card--sm"></div>').join('')}</div>
</div>

<section class="connect-section">
  <h2 class="section-title">Connect a new account</h2>
  <div class="platform-grid">
    ${platforms.map(p => `
      <button class="platform-btn" data-platform="${p}" onclick="connectPlatform('${p}')">
        ${platformIcon(p)}
        <span>${capitalize(p)}</span>
      </button>`).join('')}
  </div>
</section>

<!-- Connect callback page is handled at /accounts/callback -->`,
  });
}

// ─── New post ────────────────────────────────────────────────────────────────

export function newPostPage({ user, brand, isAdmin, asClient }) {
  const tz = user?.timezone || 'America/New_York';
  return layout({
    title: 'New Post',
    activePage: 'new',
    brand, isAdmin, asClient,
    children: `
<div class="page-header">
  <h1 class="page-title">New post</h1>
</div>

<form id="new-post-form" class="post-form" novalidate>

  <!-- Step 1: Media -->
  <section class="form-section" id="step-media">
    <h2 class="form-section-title">1. Media</h2>
    <div class="upload-area" id="upload-area">
      <input type="file" id="media-input" accept="video/*,image/*" class="upload-input" aria-label="Choose media file"/>
      <div class="upload-prompt">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4v16M8 12l8-8 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 24h24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Tap to choose a video or image</p>
        <span class="upload-hint">MP4, MOV, JPG, PNG · max 500 MB</span>
      </div>
      <div class="upload-preview" id="upload-preview" hidden>
        <video id="preview-video" class="media-preview" controls playsinline hidden></video>
        <img id="preview-image" class="media-preview" hidden alt="Preview"/>
        <p id="preview-name" class="preview-name"></p>
        <button type="button" class="btn btn--ghost btn--sm" id="change-media">Change</button>
      </div>
      <div class="upload-progress" id="upload-progress" hidden>
        <div class="progress-bar"><div class="progress-bar__fill" id="progress-fill"></div></div>
        <p id="progress-label">Uploading…</p>
      </div>
    </div>
    <input type="hidden" id="media-url" name="mediaUrl"/>
    <input type="hidden" id="media-type" name="mediaType"/>
  </section>

  <!-- Step 2: Caption -->
  <section class="form-section" id="step-caption">
    <h2 class="form-section-title">2. Caption</h2>
    <textarea id="caption" name="caption" class="form-textarea form-textarea--lg" placeholder="Write your caption…" rows="5"></textarea>
    <div class="char-count"><span id="caption-count">0</span> characters</div>

    <details class="form-details">
      <summary class="form-details-summary">First comment (Instagram / LinkedIn)</summary>
      <textarea id="first-comment" name="firstComment" class="form-textarea" placeholder="Optional first comment…" rows="2"></textarea>
    </details>
  </section>

  <!-- Step 3: Platform options -->
  <section class="form-section" id="step-platforms">
    <h2 class="form-section-title">3. Platform options</h2>

    <div class="platform-opts" id="platform-opts-container">
      <!-- Populated by JS after accounts load -->
    </div>
  </section>

  <!-- Step 4: Schedule -->
  <section class="form-section" id="step-schedule">
    <h2 class="form-section-title">4. Schedule</h2>
    <div class="schedule-row">
      <div class="form-group">
        <label class="form-label" for="schedule-time">Date &amp; time <span class="tz-label">(${escHtml(tz)})</span></label>
        <input type="datetime-local" id="schedule-time" name="scheduledAt" class="form-input"/>
      </div>
      <span class="schedule-or">or</span>
      <div class="form-group">
        <button type="button" class="btn btn--ghost" id="post-now-btn">Post immediately</button>
      </div>
    </div>
  </section>

  <div class="form-actions">
    <button type="button" class="btn btn--ghost" id="save-draft-btn">Save as draft</button>
    <button type="submit" class="btn btn--primary" id="submit-btn">Schedule post</button>
  </div>
  <p id="form-error" class="form-error" hidden></p>
  <p id="form-success" class="form-success" hidden></p>
</form>`,
  });
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export function analyticsPage({ user, brand, isAdmin, asClient }) {
  return layout({
    title: 'Analytics',
    activePage: 'analytics',
    brand, isAdmin, asClient,
    children: `
<div class="page-header">
  <h1 class="page-title">Analytics</h1>
  <select id="period-select" class="select-input">
    <option value="7d">Last 7 days</option>
    <option value="30d" selected>Last 30 days</option>
    <option value="90d">Last 90 days</option>
  </select>
</div>

<div id="account-analytics" class="analytics-grid" aria-live="polite">
  <div class="loading-skeleton">${Array(3).fill('<div class="skeleton-card"></div>').join('')}</div>
</div>

<section class="analytics-section">
  <h2 class="section-title">Post performance</h2>
  <div id="post-analytics" class="posts-list" aria-live="polite">
    <div class="loading-skeleton">${Array(4).fill('<div class="skeleton-card"></div>').join('')}</div>
  </div>
</section>`,
  });
}

// ─── Media library ───────────────────────────────────────────────────────────

export function mediaPage({ user, brand, isAdmin, asClient }) {
  return layout({
    title: 'Media',
    activePage: 'media',
    brand, isAdmin, asClient,
    children: `
<div class="page-header">
  <h1 class="page-title">Media library</h1>
</div>

<div id="media-grid" class="media-grid" aria-live="polite">
  <div class="loading-skeleton">${Array(8).fill('<div class="skeleton-card skeleton-card--sq"></div>').join('')}</div>
</div>

<div class="load-more-wrap">
  <button id="load-more-btn" class="btn btn--ghost" hidden>Load more</button>
</div>`,
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export function adminPage({ clients }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Admin — Attention Earned</title>
  <link rel="stylesheet" href="/style.css"/>
</head>
<body>
<div class="shell shell--simple">
  <div class="page-header">
    <h1 class="page-title">Admin — all clients</h1>
    <form action="/auth/logout" method="post"><button type="submit" class="btn btn--ghost btn--sm">Sign out</button></form>
  </div>
  <ul class="client-list">
    ${clients.map(c => `
      <li class="client-item">
        <div>
          <strong>${escHtml(c.name)}</strong>
          <span class="text-muted">${escHtml(c.email)}</span>
        </div>
        <div class="client-actions">
          <a href="/?asClient=${encodeURIComponent(c.email)}" class="btn btn--sm btn--ghost">View dashboard</a>
        </div>
      </li>`).join('')}
  </ul>
</div>
<script src="/app.js" type="module"></script>
</body>
</html>`;
}

// ─── Account callback ─────────────────────────────────────────────────────────

export function accountCallbackPage({ platform, connected, error }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Connecting account — Attention Earned</title>
  <link rel="stylesheet" href="/style.css"/>
</head>
<body class="auth-body">
  <div class="auth-card">
    ${connected ? `
      <div class="callback-icon callback-icon--ok">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="var(--ok)" stroke-width="1.5"/><path d="M12 20l6 6 10-10" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h1 class="auth-title">${escHtml(capitalize(platform))} connected</h1>
      <a href="/accounts" class="btn btn--primary" style="margin-top:1.5rem">Back to accounts</a>
    ` : `
      <div class="callback-icon callback-icon--err">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="var(--error)" stroke-width="1.5"/><path d="M14 14l12 12M26 14L14 26" stroke="var(--error)" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      <h1 class="auth-title">Connection failed</h1>
      <p class="auth-sub">${escHtml(error || 'Something went wrong. Please try again.')}</p>
      <a href="/accounts" class="btn btn--ghost" style="margin-top:1.5rem">Back to accounts</a>
    `}
  </div>
  <script src="/app.js" type="module"></script>
</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}

function platformIcon(platform) {
  const icons = {
    instagram: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.75"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>`,
    youtube:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" stroke="currentColor" stroke-width="1.75"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>`,
    tiktok:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    linkedin:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" stroke-width="1.75"/><path d="M7 10v7M7 7v.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M11 17v-4a2 2 0 0 1 4 0v4M11 10v7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`,
    facebook:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.75"/><path d="M15 8h-2a1 1 0 0 0-1 1v3h3l-.5 3H12v5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    twitter:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4l16 16M4 20 20 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`,
  };
  return icons[platform] || `<span>${capitalize(platform)}</span>`;
}
