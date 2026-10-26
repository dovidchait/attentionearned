/**
 * Base HTML layout.
 * brand: { primaryColor, logoUrl, name } — per-client overrides.
 * activePage: 'calendar'|'published'|'accounts'|'new'|'analytics'|'media'
 */
export function layout({ title, activePage, brand = {}, isAdmin = false, asClient = null, children }) {
  const accent = brand.primaryColor || '#FC2C30';
  const logoUrl = brand.logoUrl || '/logo.svg';
  const orgName = brand.name || 'Attention Earned';

  const nav = [
    { id: 'calendar',   href: '/',           icon: iconCalendar,  label: 'Schedule' },
    { id: 'published',  href: '/published',  icon: iconCheck,     label: 'Published' },
    { id: 'accounts',   href: '/accounts',   icon: iconLink,      label: 'Accounts' },
    { id: 'new',        href: '/new',        icon: iconPlus,      label: 'New Post' },
    { id: 'analytics',  href: '/analytics',  icon: iconChart,     label: 'Analytics' },
    { id: 'media',      href: '/media',      icon: iconMedia,     label: 'Media' },
  ];

  const adminBar = isAdmin ? `
    <div class="admin-bar">
      <span class="admin-bar__label">Admin</span>
      ${asClient ? `<span class="admin-bar__client">Viewing: <strong>${asClient}</strong></span>` : ''}
      <a href="/admin" class="admin-bar__link">All clients</a>
    </div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
  <meta name="robots" content="noindex,nofollow"/>
  <link rel="icon" href="/logo.svg" type="image/svg+xml"/>
  <title>${escHtml(title)} — ${escHtml(orgName)}</title>
  <link rel="stylesheet" href="/style.css"/>
  <style>:root { --brand: ${accent}; --brand-press: color-mix(in srgb, ${accent} 80%, #000); }</style>
</head>
<body>
  ${adminBar}
  <div class="shell">
    <aside class="sidebar" aria-label="Navigation">
      <a href="/" class="sidebar__logo">
        <img src="${logoUrl}" alt="${escHtml(orgName)}" class="sidebar__logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/>
        <span class="sidebar__logo-text" style="display:none">${escHtml(orgName)}</span>
      </a>
      <nav class="sidebar__nav">
        ${nav.map(n => `
          <a href="${n.href}" class="sidebar__link${activePage === n.id ? ' sidebar__link--active' : ''}" ${activePage === n.id ? 'aria-current="page"' : ''}>
            ${n.icon()}
            <span>${n.label}</span>
          </a>`).join('')}
      </nav>
      <form action="/auth/logout" method="post" class="sidebar__foot">
        <button type="submit" class="sidebar__logout">Sign out</button>
      </form>
    </aside>

    <main class="main-content" id="main">
      ${children}
    </main>
  </div>

  <nav class="bottom-nav" aria-label="Navigation">
    ${nav.map(n => `
      <a href="${n.href}" class="bottom-nav__item${activePage === n.id ? ' bottom-nav__item--active' : ''}" ${activePage === n.id ? 'aria-current="page"' : ''}>
        ${n.icon()}
        <span>${n.label}</span>
      </a>`).join('')}
  </nav>

  <script src="/app.js" type="module"></script>
</body>
</html>`;
}

export function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Icons (inline SVG) ─────────────────────────────────────────────────────
const iconCalendar = () => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 8h14M7 2v2M13 2v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const iconCheck    = () => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M7 10l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconLink     = () => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8 12a4 4 0 0 0 5.66 0l2-2A4 4 0 0 0 10 4.34L8.5 5.83" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8a4 4 0 0 0-5.66 0l-2 2a4 4 0 0 0 5.66 5.66L11.5 14.17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const iconPlus     = () => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const iconChart    = () => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16V10M8 16V7M12 16V4M16 16v-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const iconMedia    = () => `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 8l5 3-5 3V8z" fill="currentColor"/></svg>`;
