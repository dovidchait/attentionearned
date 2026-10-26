/**
 * Client-side JS for the dashboard.
 * All Zernio data is fetched from /api/* — no keys ever in the browser.
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function asClientParam() {
  const p = new URLSearchParams(location.search);
  const v = p.get('asClient');
  return v ? `?asClient=${encodeURIComponent(v)}` : '';
}

// ─── Calendar / Schedule ─────────────────────────────────────────────────────

const postsListEl = $('posts-list');
const editModal   = $('edit-modal');

if (postsListEl && location.pathname === '/') {
  let activeStatus = '';

  async function loadPosts(status) {
    postsListEl.innerHTML = '<div class="loading-skeleton">' + Array(4).fill('<div class="skeleton-card"></div>').join('') + '</div>';
    try {
      const q = asClientParam() ? asClientParam() + '&' : '?';
      const qs2 = status ? `${q.replace('?','')}status=${status}&` : asClientParam().replace('?', '') || '';
      const param = new URLSearchParams();
      if (status) param.set('status', status);
      const asC = new URLSearchParams(location.search).get('asClient');
      if (asC) param.set('asClient', asC);
      const data = await api('GET', `/posts?${param}`);
      const posts = data.posts || data.data || data || [];
      renderPosts(posts);
    } catch (err) {
      postsListEl.innerHTML = `<p class="empty-state__title">Could not load posts: ${esc(err.message)}</p>`;
    }
  }

  function renderPosts(posts) {
    if (!posts.length) {
      postsListEl.innerHTML = '<div class="empty-state"><p class="empty-state__title">No posts yet</p><p>Create your first post to get started.</p></div>';
      return;
    }
    postsListEl.innerHTML = posts.map(p => {
      const thumb = p.mediaUrl || p.media?.[0]?.url || '';
      const caption = p.caption || p.text || '(no caption)';
      const time = fmtDate(p.scheduledAt || p.publishedAt || p.createdAt);
      const platforms = (p.platforms || []).map(pl => `<span class="platform-badge platform-badge--${esc(pl.status)}">${esc(pl.platform)}</span>`).join('');
      return `<div class="post-card" data-id="${esc(p._id || p.id)}" onclick="openEditModal(${esc(JSON.stringify(p))})">
        ${thumb ? `<img class="post-card__thumb" src="${esc(thumb)}" alt="" loading="lazy"/>` : '<div class="post-card__thumb"></div>'}
        <div class="post-card__body">
          <p class="post-card__caption">${esc(caption)}</p>
          <div class="post-card__meta">
            ${time ? `<span>${esc(time)}</span>` : ''}
            <div class="post-card__platforms">${platforms}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('filter-chip--active'));
      chip.classList.add('filter-chip--active');
      activeStatus = chip.dataset.status || '';
      loadPosts(activeStatus);
    });
  });

  loadPosts('');
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

window.openEditModal = function(post) {
  if (!editModal) return;
  $('edit-post-id').value = post._id || post.id || '';
  $('edit-caption').value = post.caption || post.text || '';
  const scheduled = post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : '';
  $('edit-time').value = scheduled;
  editModal.showModal();
};

if ($('edit-form')) {
  $('edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('edit-post-id').value;
    const asC = new URLSearchParams(location.search).get('asClient');
    const param = asC ? `?asClient=${encodeURIComponent(asC)}` : '';
    try {
      await api('PUT', `/posts/${id}${param}`, {
        caption: $('edit-caption').value,
        scheduledAt: $('edit-time').value ? new Date($('edit-time').value).toISOString() : undefined,
      });
      editModal.close();
      loadPostsIfPresent();
    } catch (err) { alert('Error saving: ' + err.message); }
  });

  $('edit-unschedule')?.addEventListener('click', async () => {
    const id = $('edit-post-id').value;
    const asC = new URLSearchParams(location.search).get('asClient');
    const param = asC ? `?asClient=${encodeURIComponent(asC)}` : '';
    if (!confirm('Move to drafts?')) return;
    try { await api('PUT', `/posts/${id}${param}`, { isDraft: true }); editModal.close(); loadPostsIfPresent(); }
    catch (err) { alert('Error: ' + err.message); }
  });

  $('edit-delete')?.addEventListener('click', async () => {
    const id = $('edit-post-id').value;
    const asC = new URLSearchParams(location.search).get('asClient');
    const param = asC ? `?asClient=${encodeURIComponent(asC)}` : '';
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try { await api('DELETE', `/posts/${id}${param}`); editModal.close(); loadPostsIfPresent(); }
    catch (err) { alert('Error: ' + err.message); }
  });

  $('edit-postnow')?.addEventListener('click', async () => {
    const id = $('edit-post-id').value;
    const asC = new URLSearchParams(location.search).get('asClient');
    const param = asC ? `?asClient=${encodeURIComponent(asC)}` : '';
    if (!confirm('Post now? This will publish immediately.')) return;
    try { await api('POST', `/posts/${id}/publish${param}`); editModal.close(); loadPostsIfPresent(); }
    catch (err) { alert('Error posting: ' + err.message); }
  });
}

function loadPostsIfPresent() {
  const chip = document.querySelector('.filter-chip--active');
  if (chip && postsListEl) {
    const status = chip.dataset.status || '';
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const asC = new URLSearchParams(location.search).get('asClient');
    if (asC) params.set('asClient', asC);
    api('GET', `/posts?${params}`).then(d => renderPosts(d.posts || d.data || d || [])).catch(() => {});
  }
}

// ─── Published page ───────────────────────────────────────────────────────────

if (postsListEl && location.pathname === '/published') {
  async function loadPublished(status = 'published') {
    postsListEl.innerHTML = '<div class="loading-skeleton">' + Array(4).fill('<div class="skeleton-card"></div>').join('') + '</div>';
    const param = new URLSearchParams({ status });
    const asC = new URLSearchParams(location.search).get('asClient');
    if (asC) param.set('asClient', asC);
    try {
      const data = await api('GET', `/posts?${param}`);
      const posts = data.posts || data.data || data || [];
      if (!posts.length) {
        postsListEl.innerHTML = '<div class="empty-state"><p class="empty-state__title">No published posts</p></div>';
        return;
      }
      postsListEl.innerHTML = posts.map(p => {
        const caption = p.caption || p.text || '(no caption)';
        const time = fmtDate(p.publishedAt || p.createdAt);
        const platforms = (p.platforms || []).map(pl => {
          const url = pl.platformPostUrl || pl.publishedUrl;
          const badge = `<span class="platform-badge platform-badge--${esc(pl.status)}">${esc(pl.platform)}</span>`;
          return url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="post-link">${badge} ↗</a>`
            : badge;
        }).join('');
        return `<div class="post-card">
          <div class="post-card__body">
            <p class="post-card__caption">${esc(caption)}</p>
            <div class="post-card__meta">
              ${time ? `<span>${esc(time)}</span>` : ''}
              <div class="post-card__platforms">${platforms}</div>
            </div>
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      postsListEl.innerHTML = `<p class="empty-state__title">Error: ${esc(err.message)}</p>`;
    }
  }

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('filter-chip--active'));
      chip.classList.add('filter-chip--active');
      loadPublished(chip.dataset.status || 'published');
    });
  });

  loadPublished('published');
}

// ─── Accounts page ────────────────────────────────────────────────────────────

const accountsListEl = $('accounts-list');
if (accountsListEl) {
  async function loadAccounts() {
    accountsListEl.innerHTML = '<div class="loading-skeleton">' + Array(3).fill('<div class="skeleton-card skeleton-card--sm"></div>').join('') + '</div>';
    const asC = new URLSearchParams(location.search).get('asClient');
    const param = asC ? `?asClient=${encodeURIComponent(asC)}` : '';
    try {
      const data = await api('GET', `/accounts${param}`);
      const accounts = data.accounts || data.data || data || [];
      if (!accounts.length) {
        accountsListEl.innerHTML = '<div class="empty-state"><p class="empty-state__title">No accounts connected yet</p></div>';
        return;
      }
      accountsListEl.innerHTML = accounts.map(a => {
        const status = a.status || a.healthStatus || 'connected';
        const ok = status === 'connected' || status === 'active';
        return `<div class="account-card">
          <div class="account-card__info">
            <div class="account-card__name">${esc(a.platform || '')} <span class="status-dot status-dot--${ok ? 'ok' : 'error'}"></span></div>
            <div class="account-card__handle">${esc(a.username || a.handle || a.name || a._id)}</div>
          </div>
          <div class="account-card__actions">
            ${!ok ? `<button class="btn btn--sm btn--ghost" onclick="connectPlatform('${esc(a.platform)}')">Reconnect</button>` : ''}
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      accountsListEl.innerHTML = `<p class="empty-state__title">Error: ${esc(err.message)}</p>`;
    }
  }
  loadAccounts();
}

window.connectPlatform = async function(platform) {
  const asC = new URLSearchParams(location.search).get('asClient');
  const param = new URLSearchParams({ platform });
  if (asC) param.set('asClient', asC);
  try {
    const data = await api('GET', `/accounts/connect-url?${param}`);
    if (data.connectUrl) window.location.href = data.connectUrl;
  } catch (err) { alert('Error: ' + err.message); }
};

// ─── New post page ────────────────────────────────────────────────────────────

const newPostForm = $('new-post-form');
if (newPostForm) {
  let uploadedMediaUrl = null;
  let uploadedMediaType = null;

  // Load accounts for platform options
  const asC = new URLSearchParams(location.search).get('asClient');
  const acctParam = asC ? `?asClient=${encodeURIComponent(asC)}` : '';
  api('GET', `/accounts${acctParam}`).then(data => {
    const accounts = data.accounts || data.data || data || [];
    buildPlatformOpts(accounts);
  }).catch(() => {});

  function buildPlatformOpts(accounts) {
    const container = $('platform-opts-container');
    if (!container) return;
    if (!accounts.length) {
      container.innerHTML = '<p class="text-muted">No connected accounts. <a href="/accounts">Connect accounts first</a>.</p>';
      return;
    }
    const byPlatform = {};
    accounts.forEach(a => {
      if (!byPlatform[a.platform]) byPlatform[a.platform] = [];
      byPlatform[a.platform].push(a);
    });

    container.innerHTML = Object.entries(byPlatform).map(([platform, accts]) => `
      <div class="platform-opt-group" data-platform="${esc(platform)}">
        <div class="platform-opt-header">
          <input type="checkbox" class="checkbox-toggle" id="opt-${esc(platform)}" name="platforms[]" value="${esc(platform)}" checked/>
          <label for="opt-${esc(platform)}">${esc(platform.charAt(0).toUpperCase() + platform.slice(1))}</label>
        </div>
        <div class="platform-opt-body">
          <div class="form-group">
            <label class="form-label">Account${accts.length > 1 ? 's' : ''}</label>
            ${accts.map(a => `
              <label style="display:flex;gap:0.5rem;align-items:center;font-size:0.85rem;margin-top:4px">
                <input type="checkbox" name="accountIds[]" value="${esc(a._id || a.id)}" checked/>
                ${esc(a.username || a.handle || a.name || a._id)}
              </label>`).join('')}
          </div>
          ${platform === 'youtube' ? `
            <div class="form-group">
              <label class="form-label" for="yt-title">YouTube title</label>
              <input type="text" id="yt-title" name="youtubeTitle" class="form-input" placeholder="Video title"/>
            </div>
            <div class="form-group">
              <label class="form-label" for="yt-playlist">Playlist ID (optional)</label>
              <input type="text" id="yt-playlist" name="youtubePlaylistId" class="form-input" placeholder="PLxx..."/>
            </div>` : ''}
          ${platform === 'tiktok' ? `
            <div class="form-group">
              <label class="form-label" for="tt-privacy">TikTok privacy</label>
              <select id="tt-privacy" name="tiktokPrivacy" class="select-input form-input">
                <option value="PUBLIC_TO_EVERYONE">Public</option>
                <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                <option value="SELF_ONLY">Private</option>
              </select>
            </div>` : ''}
          ${platform === 'instagram' ? `
            <div class="form-group">
              <label class="form-label" for="ig-type">Post type</label>
              <select id="ig-type" name="instagramType" class="select-input form-input">
                <option value="">Auto-detect</option>
                <option value="reel">Reel</option>
                <option value="story">Story</option>
              </select>
            </div>` : ''}
        </div>
      </div>`).join('');
  }

  // Caption counter
  const captionEl = $('caption');
  const captionCount = $('caption-count');
  captionEl?.addEventListener('input', () => {
    if (captionCount) captionCount.textContent = captionEl.value.length;
  });

  // Media upload
  const mediaInput = $('media-input');
  const uploadArea = $('upload-area');
  const uploadPrompt = uploadArea?.querySelector('.upload-prompt');
  const uploadPreview = $('upload-preview');
  const uploadProgress = $('upload-progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const previewVideo = $('preview-video');
  const previewImage = $('preview-image');
  const previewName = $('preview-name');

  mediaInput?.addEventListener('change', () => handleFileSelect(mediaInput.files[0]));

  $('change-media')?.addEventListener('click', e => {
    e.stopPropagation();
    mediaInput.value = '';
    uploadedMediaUrl = null;
    uploadedMediaType = null;
    uploadPreview.hidden = true;
    uploadPrompt.hidden = false;
    $('media-url').value = '';
    $('media-type').value = '';
  });

  // Drag and drop
  if (uploadArea) {
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('upload-area--drag'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('upload-area--drag'));
    uploadArea.addEventListener('drop', e => {
      e.preventDefault();
      uploadArea.classList.remove('upload-area--drag');
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    });
  }

  async function handleFileSelect(file) {
    if (!file) return;
    // Show preview
    uploadPrompt.hidden = true;
    uploadPreview.hidden = true;
    uploadProgress.hidden = false;
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Getting upload URL…';

    const asC2 = new URLSearchParams(location.search).get('asClient');
    const param2 = asC2 ? `?asClient=${encodeURIComponent(asC2)}` : '';

    try {
      // 1. Get presigned URL from server
      const presignData = await api('POST', `/media/presign${param2}`, {
        filename: file.name,
        contentType: file.type,
        size: file.size,
      });

      progressLabel.textContent = 'Uploading…';

      // 2. PUT file directly to presigned URL (Zernio storage — no API key in this request)
      await uploadWithProgress(presignData.uploadUrl, file, pct => {
        progressFill.style.width = pct + '%';
        progressLabel.textContent = `Uploading… ${pct}%`;
      });

      uploadedMediaUrl = presignData.publicUrl;
      uploadedMediaType = file.type.startsWith('video/') ? 'video' : 'image';
      $('media-url').value = uploadedMediaUrl;
      $('media-type').value = uploadedMediaType;

      // Show preview
      uploadProgress.hidden = true;
      uploadPreview.hidden = false;
      previewName.textContent = file.name;
      if (uploadedMediaType === 'video') {
        previewVideo.src = URL.createObjectURL(file);
        previewVideo.hidden = false;
        previewImage.hidden = true;
      } else {
        previewImage.src = URL.createObjectURL(file);
        previewImage.hidden = false;
        previewVideo.hidden = true;
      }
    } catch (err) {
      uploadProgress.hidden = true;
      uploadPrompt.hidden = false;
      alert('Upload failed: ' + err.message);
    }
  }

  function uploadWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
      });
      xhr.addEventListener('load', () => xhr.status < 400 ? resolve() : reject(new Error(`Upload HTTP ${xhr.status}`)));
      xhr.addEventListener('error', () => reject(new Error('Upload network error')));
      xhr.send(file);
    });
  }

  // Schedule / post-now / save draft
  const postNowBtn = $('post-now-btn');
  const saveDraftBtn = $('save-draft-btn');
  const submitBtn = $('submit-btn');
  const formError = $('form-error');
  const formSuccess = $('form-success');

  function collectFormData(extra = {}) {
    const accountIds = [...document.querySelectorAll('[name="accountIds[]"]:checked')].map(el => el.value);
    const platforms = accountIds.map(id => {
      // build per-platform options
      const opts = {};
      const ytTitle = $('yt-title')?.value;
      const ytPlaylist = $('yt-playlist')?.value;
      const ttPrivacy = $('tt-privacy')?.value;
      const igType = $('ig-type')?.value;
      if (ytTitle) opts.title = ytTitle;
      if (ytPlaylist) opts.playlistId = ytPlaylist;
      if (ttPrivacy) opts.privacyLevel = ttPrivacy;
      if (igType) opts.type = igType;
      return { accountId: id, ...opts };
    });

    const caption = captionEl?.value || '';
    const firstComment = $('first-comment')?.value || undefined;
    const scheduledAt = $('schedule-time')?.value
      ? new Date($('schedule-time').value).toISOString()
      : undefined;
    const mediaUrl = $('media-url')?.value || undefined;
    const mediaType = $('media-type')?.value || undefined;

    return {
      caption,
      ...(firstComment ? { firstComment } : {}),
      ...(mediaUrl ? { media: [{ url: mediaUrl, type: mediaType || 'video' }] } : {}),
      platforms,
      ...(scheduledAt ? { scheduledAt } : {}),
      ...extra,
    };
  }

  async function submitPost(extra = {}) {
    formError.hidden = true;
    formSuccess.hidden = true;
    submitBtn.disabled = true;
    saveDraftBtn.disabled = true;

    const asC3 = new URLSearchParams(location.search).get('asClient');
    const param3 = asC3 ? `?asClient=${encodeURIComponent(asC3)}` : '';

    try {
      await api('POST', `/posts${param3}`, collectFormData(extra));
      formSuccess.textContent = extra.publishNow ? 'Post sent!' : extra.isDraft ? 'Saved as draft.' : 'Post scheduled!';
      formSuccess.hidden = false;
      newPostForm.reset();
      uploadedMediaUrl = null;
      uploadedMediaType = null;
      if (uploadPreview) uploadPreview.hidden = true;
      if (uploadPrompt) uploadPrompt.hidden = false;
    } catch (err) {
      formError.textContent = err.message;
      formError.hidden = false;
    } finally {
      submitBtn.disabled = false;
      saveDraftBtn.disabled = false;
    }
  }

  newPostForm.addEventListener('submit', e => { e.preventDefault(); submitPost(); });
  postNowBtn?.addEventListener('click', () => submitPost({ publishNow: true }));
  saveDraftBtn?.addEventListener('click', () => submitPost({ isDraft: true }));
}

// ─── Analytics page ───────────────────────────────────────────────────────────

const analyticsGrid = $('account-analytics');
const postAnalytics = $('post-analytics');
if (analyticsGrid) {
  async function loadAnalytics(period = '30d') {
    const asC = new URLSearchParams(location.search).get('asClient');
    const param = asC ? `?asClient=${encodeURIComponent(asC)}` : '';

    // Load accounts then fetch analytics for each
    try {
      const acctData = await api('GET', `/accounts${param}`);
      const accounts = acctData.accounts || acctData.data || acctData || [];
      if (!accounts.length) {
        analyticsGrid.innerHTML = '<p class="empty-state__title">No connected accounts</p>';
        return;
      }

      const results = await Promise.allSettled(
        accounts.slice(0, 6).map(a => {
          const p = new URLSearchParams({ period });
          if (asC) p.set('asClient', asC);
          return api('GET', `/accounts/${a._id || a.id}/analytics?${p}`);
        })
      );

      analyticsGrid.innerHTML = results.map((r, i) => {
        const a = accounts[i];
        if (r.status === 'rejected') {
          return `<div class="analytics-card"><div class="analytics-card__label">${esc(a.platform)} · ${esc(a.username || a.handle || '')}</div><div class="analytics-card__sub">Analytics not available</div></div>`;
        }
        const d = r.value;
        const followers = d.followers ?? d.followerCount ?? d.subscribers ?? '—';
        const reach = d.reach ?? d.impressions ?? d.views ?? '—';
        return `<div class="analytics-card">
          <div class="analytics-card__label">${esc(a.platform)} · ${esc(a.username || a.handle || '')}</div>
          <div class="analytics-card__value">${fmt(followers)}</div>
          <div class="analytics-card__sub">${fmt(reach)} reach · ${period}</div>
        </div>`;
      }).join('');
    } catch (err) {
      analyticsGrid.innerHTML = `<p class="empty-state__title">Error: ${esc(err.message)}</p>`;
    }

    // Post analytics
    if (postAnalytics) {
      try {
        const p2 = new URLSearchParams({ status: 'published', limit: 20 });
        if (asC) p2.set('asClient', asC);
        const pData = await api('GET', `/posts?${p2}`);
        const posts = pData.posts || pData.data || pData || [];
        if (!posts.length) {
          postAnalytics.innerHTML = '<div class="empty-state"><p class="empty-state__title">No published posts yet</p></div>';
          return;
        }
        postAnalytics.innerHTML = posts.map(p => {
          const views = p.analytics?.views ?? p.views ?? '—';
          const likes = p.analytics?.likes ?? p.likes ?? '—';
          return `<div class="post-card">
            <div class="post-card__body">
              <p class="post-card__caption">${esc(p.caption || p.text || '(no caption)')}</p>
              <div class="post-card__meta">
                <span>${fmtDate(p.publishedAt || p.createdAt)}</span>
                <span>${fmt(views)} views · ${fmt(likes)} likes</span>
              </div>
            </div>
          </div>`;
        }).join('');
      } catch {}
    }
  }

  $('period-select')?.addEventListener('change', e => loadAnalytics(e.target.value));
  loadAnalytics('30d');
}

function fmt(n) {
  if (n === '—' || n == null) return '—';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

// ─── Media library ────────────────────────────────────────────────────────────

const mediaGrid = $('media-grid');
if (mediaGrid) {
  let page = 1;
  const loadMoreBtn = $('load-more-btn');
  const asC = new URLSearchParams(location.search).get('asClient');

  async function loadMedia(p = 1) {
    if (p === 1) mediaGrid.innerHTML = '<div class="loading-skeleton media-grid">' + Array(8).fill('<div class="skeleton-card skeleton-card--sq"></div>').join('') + '</div>';
    const param = new URLSearchParams({ page: p, limit: 24 });
    if (asC) param.set('asClient', asC);
    try {
      const data = await api('GET', `/media?${param}`);
      const items = data.media || data.items || data.data || data || [];
      if (p === 1) mediaGrid.innerHTML = '';
      if (!items.length && p === 1) {
        mediaGrid.innerHTML = '<div class="empty-state"><p class="empty-state__title">No media yet</p></div>';
        return;
      }
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'media-item';
        const url = item.url || item.publicUrl || item.thumbnailUrl || '';
        const type = item.type || (url.match(/\.(mp4|mov|webm)/i) ? 'video' : 'image');
        el.innerHTML = `
          <img src="${esc(item.thumbnailUrl || url)}" alt="" loading="lazy"/>
          <span class="media-item__type">${esc(type)}</span>
          <div class="media-item__overlay"></div>`;
        el.addEventListener('click', () => {
          if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => alert('URL copied!')).catch(() => prompt('Copy URL:', url));
          else prompt('Copy URL:', url);
        });
        mediaGrid.appendChild(el);
      });
      const hasMore = data.hasMore ?? (items.length === 24);
      if (loadMoreBtn) loadMoreBtn.hidden = !hasMore;
    } catch (err) {
      if (p === 1) mediaGrid.innerHTML = `<p class="empty-state__title">Error: ${esc(err.message)}</p>`;
    }
  }

  loadMoreBtn?.addEventListener('click', () => { page++; loadMedia(page); });
  loadMedia(1);
}
