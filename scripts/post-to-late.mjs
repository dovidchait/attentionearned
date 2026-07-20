#!/usr/bin/env node
/**
 * Reads newly added content MDX files (passed as CLI args) and posts each one
 * to Late.dev for distribution to connected social media accounts.
 *
 * Usage: node scripts/post-to-late.mjs path/to/file.mdx [...]
 *
 * Required env vars:
 *   LATE_DEV_API_KEY   – your Late.dev API key (Settings → API)
 *   SITE_URL           – public site URL, e.g. https://attentionearned.com
 *
 * Optional env vars:
 *   LATE_DEV_PROFILE_IDS  – comma-separated Late.dev profile IDs to post to.
 *                           If omitted the script fetches all connected profiles.
 */

import { readFileSync } from 'fs';
import { basename, extname } from 'path';

const LATE_API = 'https://app.late.dev/api/v1';
const API_KEY = process.env.LATE_DEV_API_KEY;
const SITE_URL = (process.env.SITE_URL || 'https://attentionearned.com').replace(/\/$/, '');

if (!API_KEY) {
  console.error('ERROR: LATE_DEV_API_KEY env var is required');
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('No files provided — nothing to post.');
  process.exit(0);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (val) fm[key] = val;
  }
  return fm;
}

function slugFromPath(filePath) {
  return basename(filePath, extname(filePath));
}

function pageUrlForFile(filePath) {
  // Determine URL segment based on directory
  if (filePath.includes('/content/work/')) return `${SITE_URL}/work/${slugFromPath(filePath)}`;
  if (filePath.includes('/content/services/')) return `${SITE_URL}/services/${slugFromPath(filePath)}`;
  if (filePath.includes('/content/pages/')) return `${SITE_URL}/${slugFromPath(filePath)}`;
  return SITE_URL;
}

function buildPostText({ title, summary, sector, url }) {
  const sectorTag = sector ? `#${sector.replace(/-/g, '')}` : '';
  const tags = ['#videoproduction', '#attentionearned', sectorTag].filter(Boolean).join(' ');

  // Keep under ~280 chars for Twitter; longer posts are fine for other platforms.
  const body = summary?.length > 200 ? summary.slice(0, 197) + '…' : summary || '';

  return `${title}\n\n${body}\n\n${url}\n\n${tags}`.trim();
}

async function lateRequest(method, path, body) {
  const res = await fetch(`${LATE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Late.dev ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function getProfileIds() {
  if (process.env.LATE_DEV_PROFILE_IDS) {
    return process.env.LATE_DEV_PROFILE_IDS.split(',').map(s => s.trim()).filter(Boolean);
  }
  const data = await lateRequest('GET', '/profiles');
  // Late.dev returns { profiles: [{ id, platform, ... }] }
  const profiles = data.profiles ?? data.data ?? [];
  if (profiles.length === 0) throw new Error('No connected social profiles found in Late.dev');
  return profiles.map(p => p.id);
}

// ── main ─────────────────────────────────────────────────────────────────────

const profileIds = await getProfileIds();
console.log(`Posting to ${profileIds.length} Late.dev profile(s): ${profileIds.join(', ')}`);

let posted = 0;
let failed = 0;

for (const filePath of files) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const fm = parseFrontmatter(raw);

    if (!fm.title) {
      console.warn(`SKIP ${filePath}: no title in frontmatter`);
      continue;
    }

    // Skip unlisted/draft pages
    if (fm.unlisted === 'true') {
      console.log(`SKIP ${filePath}: marked unlisted`);
      continue;
    }

    const url = pageUrlForFile(filePath);
    const text = buildPostText({
      title: fm.title,
      summary: fm.summary,
      sector: fm.sector,
      url,
    });

    console.log(`\nPosting: ${fm.title}`);
    console.log(`URL: ${url}`);
    console.log(`Text preview: ${text.slice(0, 120)}…`);

    // Late.dev create-post payload
    // Docs: https://docs.late.dev/api-reference/posts/create
    const payload = {
      profiles: profileIds,
      text,
      // Publish immediately; swap for an ISO timestamp to schedule instead:
      // scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    // If it's a YouTube video, attach the link so Late.dev can pull the thumbnail
    if (fm.provider === 'youtube' && fm.src) {
      payload.link = `https://www.youtube.com/watch?v=${fm.src}`;
    } else if (fm.provider === 'vimeo' && fm.src) {
      payload.link = `https://vimeo.com/${fm.src}`;
    }

    const result = await lateRequest('POST', '/posts', payload);
    console.log(`✓ Created Late.dev post id=${result.id ?? result.data?.id ?? 'unknown'}`);
    posted++;
  } catch (err) {
    console.error(`✗ Failed for ${filePath}: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. Posted: ${posted}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
