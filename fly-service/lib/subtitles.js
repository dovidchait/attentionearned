import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// ============================================================================
// SUBTITLE PIPELINE
// transcribe (Whisper) -> word timing -> ASS file (karaoke highlight) ->
// ffmpeg burn-in -> preview frame + burned video
// ============================================================================

const execFileAsync = promisify(execFile);

// ---- defaults ---------------------------------------------------------------

const STYLE_DEFAULTS = {
  font: 'Arial',
  textColor: '&H00FFFFFF',   // white
  activeColor: '&H0000FFFF', // yellow
  outlineColor: '&H00000000', // black
  outlineWidth: 2,
  shadow: false,
  allCaps: false,
  punctuation: true,
  landscape: { size: 72, marginV: 100, maxWordsPerLine: 5 },
  portrait:  { size: 80, marginV: 300, maxWordsPerLine: 3 }
};

// David's default preset (stored in users.json; duplicated here only as the
// named-preset reference for tests)
export const DAVID_PRESET = {
  font: 'Lilita One',
  textColor: '#FBF8F1',
  activeColor: '#FC2C30',
  outlineColor: '#000000',
  outlineWidth: 7,
  shadow: false,
  allCaps: true,
  punctuation: false,
  landscape: { size: 84, marginV: 190, maxWordsPerLine: 4 },
  portrait:  { size: 92, marginV: 430, maxWordsPerLine: 3 }
};

// ---- colour helpers ---------------------------------------------------------

/** Convert #RRGGBB or #AARRGGBB -> ASS &HAABBGGRR */
function hexToAss(hex) {
  const h = hex.replace(/^#/, '');
  let r, g, b, a = 0;
  if (h.length === 6)      { r = h.slice(0,2); g = h.slice(2,4); b = h.slice(4,6); }
  else if (h.length === 8) { a = parseInt(h.slice(0,2), 16); r = h.slice(2,4); g = h.slice(4,6); b = h.slice(6,8); }
  else return '&H00FFFFFF';
  return `&H${String(a).padStart(2,'0').toUpperCase()}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function assColour(val) {
  if (!val) return '&H00FFFFFF';
  if (val.startsWith('&H')) return val;
  return hexToAss(val);
}

// ---- style normalisation ----------------------------------------------------

/** Merge a per-client style object (from users.json) with STYLE_DEFAULTS.
 * Priority: rawStyle[aspectRatio] > rawStyle top-level > STYLE_DEFAULTS[aspectRatio] > STYLE_DEFAULTS */
export function resolveStyle(rawStyle, aspectRatio = 'landscape') {
  const aspectDefaults = STYLE_DEFAULTS[aspectRatio] || STYLE_DEFAULTS.landscape;
  const aspectOverride = rawStyle?.[aspectRatio] || {};
  return {
    ...STYLE_DEFAULTS,
    ...aspectDefaults,
    ...(rawStyle || {}),
    ...aspectOverride
  };
}

// ---- Whisper API ------------------------------------------------------------

/**
 * Transcribe a video/audio buffer using OpenAI Whisper API.
 * Returns [{word, start, end}, …] (seconds).
 * Requires OPENAI_API_KEY in env.
 */
export async function transcribeAudio(buffer, contentType = 'video/mp4', filename = 'audio.mp4') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const whisperUrl = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1') + '/audio/transcriptions';

  const form = new FormData();
  const blob = new Blob([buffer], { type: contentType });
  form.append('file', blob, filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch(whisperUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Whisper API error ${res.status}: ${err}`);
  }
  const json = await res.json();
  return (json.words || []).map(w => ({ word: w.word, start: w.start, end: w.end }));
}

// ---- vocabulary / find-replace ----------------------------------------------

/**
 * Apply a find-replace vocabulary list to word tokens.
 * vocabulary: [{find: "Zernyo", replace: "Zernio"}, …]
 * Matching is case-insensitive against the bare word; casing is replaced.
 */
export function applyVocabulary(words, vocabulary = []) {
  if (!vocabulary.length) return words;
  const map = new Map(vocabulary.map(v => [v.find.toLowerCase(), v.replace]));
  return words.map(w => {
    const clean = w.word.replace(/[^a-zA-Z0-9''-]/g, '').toLowerCase();
    if (map.has(clean)) return { ...w, word: w.word.replace(new RegExp(clean, 'i'), map.get(clean)) };
    return w;
  });
}

// ---- ASS builder ------------------------------------------------------------

/** Convert seconds to ASS timestamp h:mm:ss.cs */
function toASS(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

/** Group flat word list into lines, respecting maxWordsPerLine. */
function groupIntoLines(words, maxWords) {
  const lines = [];
  for (let i = 0; i < words.length; i += maxWords) lines.push(words.slice(i, i + maxWords));
  return lines;
}

/**
 * Build an ASS subtitle string with karaoke active-word highlighting.
 * Each line shows maxWordsPerLine words at a time; the active word is coloured
 * using {\1c&Hactive&} override tags.
 *
 * style fields used: font, textColor, activeColor, outlineColor, outlineWidth,
 *   shadow, allCaps, punctuation, size, marginV, maxWordsPerLine
 */
export function buildASS(words, style, { width = 1920, height = 1080 } = {}) {
  if (!words.length) return '';

  const primaryColour = assColour(style.textColor);
  const activeColour  = assColour(style.activeColor);
  const outlineColour = assColour(style.outlineColor);
  const shadowDepth   = style.shadow ? 2 : 0;
  const marginV       = style.marginV || 100;
  const fontSize      = style.size || 72;
  const fontName      = style.font || 'Arial';
  const maxWords      = style.maxWordsPerLine || 5;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColour},${activeColour},${outlineColour},&H00000000,1,0,0,0,100,100,0,0,1,${style.outlineWidth || 2},${shadowDepth},2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = groupIntoLines(words, maxWords);
  const dialogLines = [];

  for (const group of lines) {
    const lineStart = group[0].start;
    const lineEnd   = group[group.length - 1].end;

    // Build the karaoke text: normal text with {\1c} resets; active word gets
    // the activeColour applied for its duration using {\k<cs>} timing tags.
    let text = '';
    for (let i = 0; i < group.length; i++) {
      const w = group[i];
      let display = w.word.trim();
      if (!style.punctuation) display = display.replace(/[.,!?;:…—–-]+$/g, '');
      if (style.allCaps) display = display.toUpperCase();
      const durationCs = Math.max(1, Math.round((w.end - w.start) * 100));
      // The word is highlighted {\1c<active>} during its karaoke slot, then
      // resets to primary via {\1c<primary>} for subsequent words.
      text += `{\\1c${activeColour}\\k${durationCs}}${display}{\\1c${primaryColour}} `;
    }

    dialogLines.push(`Dialogue: 0,${toASS(lineStart)},${toASS(lineEnd)},Default,,0,0,0,,${text.trimEnd()}`);
  }

  return `${header}\n${dialogLines.join('\n')}\n`;
}

// ---- ffmpeg helpers ---------------------------------------------------------

async function ffmpegAvailable() {
  try { await execFileAsync('ffmpeg', ['-version']); return true; }
  catch { return false; }
}

/**
 * Burn an ASS file into a video, producing a new file at outputPath.
 * Source resolution and quality are preserved (libx264 -crf 16).
 */
export async function burnSubtitles(inputPath, assPath, outputPath) {
  // Escape the path for the ffmpeg subtitles filter
  const escaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
  await execFileAsync('ffmpeg', [
    '-y', '-i', inputPath,
    '-vf', `ass='${escaped}'`,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart',
    outputPath
  ], { maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Extract a preview frame (mid-point) from a video.
 * Returns the frame as a Buffer (JPEG).
 */
export async function extractPreviewFrame(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', videoPath
  ]);
  const streams = JSON.parse(stdout).streams || [];
  const video = streams.find(s => s.codec_type === 'video');
  const duration = parseFloat(video?.duration || '10');
  const midpoint = (duration / 2).toFixed(2);

  const tmpOut = path.join(os.tmpdir(), `tta-preview-${crypto.randomBytes(6).toString('hex')}.jpg`);
  await execFileAsync('ffmpeg', [
    '-y', '-ss', midpoint, '-i', videoPath,
    '-frames:v', '1', '-q:v', '2', tmpOut
  ]);
  const buf = fs.readFileSync(tmpOut);
  fs.rmSync(tmpOut, { force: true });
  return buf;
}

// ---- main pipeline ----------------------------------------------------------

/**
 * Full subtitle pipeline for one video.
 *
 * @param {Buffer} videoBuffer
 * @param {string} contentType
 * @param {object} options
 *   style         - resolved style (from resolveStyle())
 *   vocabulary    - [{find, replace}, …]
 *   aspectRatio   - 'landscape' | 'portrait'
 *   filename      - original filename hint
 * @returns {{ videoBuffer: Buffer, assContent: string, srtContent: string,
 *              previewBuffer: Buffer, words: Array }}
 */
export async function processVideo(videoBuffer, contentType, {
  style,
  vocabulary = [],
  aspectRatio = 'landscape',
  filename = 'video.mp4'
} = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-subs-'));
  const ext = contentType.includes('quicktime') ? '.mov' : '.mp4';
  const inputPath  = path.join(tmpDir, `input${ext}`);
  const assPath    = path.join(tmpDir, 'subs.ass');
  const srtPath    = path.join(tmpDir, 'subs.srt');
  const outputPath = path.join(tmpDir, `burned${ext}`);

  try {
    fs.writeFileSync(inputPath, videoBuffer);

    // 1. Probe dimensions for ASS PlayRes
    let width = aspectRatio === 'portrait' ? 1080 : 1920;
    let height = aspectRatio === 'portrait' ? 1920 : 1080;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', inputPath
      ]);
      const streams = JSON.parse(stdout).streams || [];
      const vs = streams.find(s => s.codec_type === 'video');
      if (vs?.width)  width  = vs.width;
      if (vs?.height) height = vs.height;
    } catch { /* use defaults */ }

    // 2. Transcribe
    const rawWords = await transcribeAudio(videoBuffer, contentType, filename);

    // 3. Vocabulary find-replace
    const words = applyVocabulary(rawWords, vocabulary);

    // 4. Build ASS
    const assContent = buildASS(words, style, { width, height });
    fs.writeFileSync(assPath, assContent);

    // 5. Build SRT (optional export)
    const srtContent = wordsToSrt(words, style);
    fs.writeFileSync(srtPath, srtContent);

    // 6. Burn in
    await burnSubtitles(inputPath, assPath, outputPath);
    const burnedBuffer = fs.readFileSync(outputPath);

    // 7. Preview frame
    const previewBuffer = await extractPreviewFrame(outputPath);

    return { videoBuffer: burnedBuffer, assContent, srtContent, previewBuffer, words };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- SRT export -------------------------------------------------------------

/** Convert word list to SRT format (line per group). */
export function wordsToSrt(words, style = {}) {
  if (!words.length) return '';
  const maxWords = style.maxWordsPerLine || 5;
  const lines = groupIntoLines(words, maxWords);
  return lines.map((group, idx) => {
    const start = group[0].start;
    const end   = group[group.length - 1].end;
    const text  = group.map(w => {
      let display = w.word.trim();
      if (!style.punctuation) display = display.replace(/[.,!?;:…—–-]+$/g, '');
      if (style.allCaps) display = display.toUpperCase();
      return display;
    }).join(' ');
    return `${idx + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`;
  }).join('\n\n') + '\n';
}

function srtTime(sec) {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

// ---- brand onboarding helper ------------------------------------------------

/**
 * Propose a subtitle style from a website URL.
 * Fetches the site's CSS and tries to pull primary/accent colours and Google Font name.
 * Returns a partial style object for owner review.
 * Requires OPENAI_API_KEY (uses a quick GPT call for colour/font extraction).
 */
export async function proposeStyleFromSite(siteUrl) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  // Fetch the page HTML (first 40KB)
  const res = await fetch(siteUrl, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Could not fetch ${siteUrl}: ${res.status}`);
  const html = (await res.text()).slice(0, 40000);

  const prompt = `Extract brand style hints from this HTML/CSS snippet.
Return ONLY a JSON object with these exact keys (hex colours, string font name):
{ "textColor": "#hex", "activeColor": "#hex", "outlineColor": "#hex", "font": "Font Name" }
Use the most prominent body/heading text colour for textColor, the primary accent/CTA colour for activeColor, and black or a dark background colour for outlineColor.
If a Google Font is loaded, use its name for "font"; otherwise use "Arial".
HTML:
${html}`;

  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 200
    })
  });
  if (!chatRes.ok) throw new Error(`GPT error: ${chatRes.status}`);
  const chatJson = await chatRes.json();
  const proposed = JSON.parse(chatJson.choices[0].message.content);

  return {
    font:         proposed.font || 'Arial',
    textColor:    proposed.textColor || '#FFFFFF',
    activeColor:  proposed.activeColor || '#FFFF00',
    outlineColor: proposed.outlineColor || '#000000',
    outlineWidth: 4,
    shadow:       false,
    allCaps:      false,
    punctuation:  true,
    landscape: { size: 72, marginV: 100, maxWordsPerLine: 5 },
    portrait:  { size: 80, marginV: 300, maxWordsPerLine: 3 }
  };
}

export { ffmpegAvailable };
