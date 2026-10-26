import fetch from 'node-fetch';

// ============================================================================
// MEDIA LINKS: a Dropbox / Google Drive / direct file URL in the message text
// is used as the media, for videos too big to attach (WhatsApp caps at 16 MB).
// ============================================================================

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const FILE_EXT = /\.(mp4|mov|m4v|webm|3gp|jpe?g|png|gif|webp|heic)$/i;

const MIME_BY_EXT = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', '3gp': 'video/3gpp',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic'
};

function extOf(value = '') {
  try {
    return (new URL(value).pathname.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  } catch {
    return (String(value).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  }
}

export function isMediaLink(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)dropbox\.com$/.test(host) || host === 'dl.dropboxusercontent.com') return true;
  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') return true;
  if (host === 'docs.google.com' && u.pathname.startsWith('/uc')) return true;
  return FILE_EXT.test(u.pathname);
}

/** Media links found in a message, in order, without duplicates. */
export function findMediaLinks(text = '') {
  const found = (String(text).match(URL_RE) || []).map(u => u.replace(/[.,;:!?]+$/, ''));
  return [...new Set(found)].filter(isMediaLink);
}

export function removeLinks(text = '', links = []) {
  let out = String(text);
  for (const link of links) out = out.split(link).join('');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Best guess before downloading: 'video' unless the URL says it's an image. */
export function guessContentType(url) {
  return MIME_BY_EXT[extOf(url)] || 'video/mp4';
}

/** Turn a share link into a direct-download link. */
export function directDownloadUrl(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.delete('dl');
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || u.searchParams.get('id');
    if (id) return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  return url;
}

function maxLinkBytes() {
  return (parseFloat(process.env.MAX_LINK_MEDIA_MB) || 250) * 1024 * 1024;
}

/** Download a media link. Throws an Error whose message is safe to show the user. */
export async function downloadLink(url, { maxBytes = maxLinkBytes(), timeoutMs = 300000 } = {}) {
  const direct = directDownloadUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(direct, { redirect: 'follow', signal: controller.signal });
    } catch (error) {
      throw new Error(`couldn't download the link (${error.name === 'AbortError' ? 'timed out' : error.message})`);
    }
    if (!response.ok) throw new Error(`couldn't download the link (HTTP ${response.status}). Is it shared as "anyone with the link"?`);

    let contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('text/html')) {
      throw new Error('the link opens a web page, not the file. Share it as "anyone with the link" (Drive) or a public link (Dropbox)');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const nameFromHeader = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
    const filename = decodeURIComponent(nameFromHeader || new URL(direct).pathname.split('/').pop() || `link-${Date.now()}`);
    if (!contentType.startsWith('video/') && !contentType.startsWith('image/')) {
      contentType = MIME_BY_EXT[extOf(filename)] || MIME_BY_EXT[extOf(url)] || '';
    }
    if (!contentType) throw new Error("the link isn't a video or photo file");

    const declared = parseInt(response.headers.get('content-length') || '0', 10);
    const limitMb = Math.round(maxBytes / 1024 / 1024);
    if (declared > maxBytes) throw new Error(`the file is over ${limitMb} MB`);

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) {
        controller.abort();
        throw new Error(`the file is over ${limitMb} MB`);
      }
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), contentType, filename };
  } finally {
    clearTimeout(timeout);
  }
}
