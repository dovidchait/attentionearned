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

// Neutral fallback look. Every brand sets its own style in users.json
// (user.subtitles.style); a client with no style gets this plain look, never
// another brand's preset. David's own look lives only on his own entry in
// users.json.
export const STYLE_DEFAULTS = {
  font: 'Arial',
  textColor: '#FFFFFF',   // white
  activeColor: '#FFFF00', // yellow
  outlineColor: '#000000', // black
  outlineWidth: 2,
  shadow: false,
  allCaps: false,
  punctuation: true,
  landscape: { size: 72, marginV: 100, maxWordsPerLine: 5 },
  portrait:  { size: 80, marginV: 300, maxWordsPerLine: 3 }
};

// Reference canvas the style sizes are written for (1080p). The ASS PlayRes
// keeps this height and the video's own aspect, so a size-84 caption looks the
// same on a 720p phone clip as on a 4K file.
const REFERENCE_HEIGHT = { landscape: 1080, portrait: 1920 };

// Whisper's upload limit is 25 MB; stay under it with headroom.
export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

// ---- colour helpers ---------------------------------------------------------

function splitHex(hex) {
  const h = String(hex).replace(/^#/, '');
  if (!/^([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h)) return null;
  if (h.length === 6) return { a: '00', r: h.slice(0, 2), g: h.slice(2, 4), b: h.slice(4, 6) };
  // #AARRGGBB, where AA is ASS alpha (00 = opaque, FF = transparent)
  return { a: h.slice(0, 2), r: h.slice(2, 4), g: h.slice(4, 6), b: h.slice(6, 8) };
}

/** Convert #RRGGBB or #AARRGGBB -> ASS style colour &HAABBGGRR */
export function hexToAss(hex) {
  const c = splitHex(hex);
  if (!c) return '&H00FFFFFF';
  return `&H${c.a}${c.b}${c.g}${c.r}`.toUpperCase();
}

/** Style-line colour (&HAABBGGRR). Accepts #hex or an existing &H value. */
function assColour(val) {
  if (!val) return '&H00FFFFFF';
  if (String(val).startsWith('&H')) return val;
  return hexToAss(val);
}

/** Override-tag colour for {\1c...}: &HBBGGRR& (no alpha byte, trailing &). */
export function assTagColour(val) {
  const full = assColour(val).replace(/&$/, '');      // &HAABBGGRR or &HBBGGRR
  const digits = full.slice(2);
  const bgr = digits.length === 8 ? digits.slice(2) : digits.padStart(6, '0');
  return `&H${bgr.toUpperCase()}&`;
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

// ---- probing ----------------------------------------------------------------

/**
 * Display size of a video stream from ffprobe JSON, with phone rotation applied
 * (a portrait iPhone clip is often stored 1920x1080 with a 90 degree rotation).
 */
export function displaySize(stream = {}) {
  let width = Number(stream.width) || 0;
  let height = Number(stream.height) || 0;
  let rotation = Number(stream.tags?.rotate || 0);
  for (const sd of stream.side_data_list || []) {
    if (sd.rotation !== undefined) rotation = Number(sd.rotation);
  }
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  return { width, height };
}

export function aspectOf({ width, height }) {
  return width && height && width < height ? 'portrait' : 'landscape';
}

/** ffprobe a file: { width, height, duration, hasAudio, aspectRatio } */
export async function probeVideo(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath
  ]);
  const info = JSON.parse(stdout);
  const streams = info.streams || [];
  const vs = streams.find(s => s.codec_type === 'video');
  const { width, height } = displaySize(vs);
  const duration = parseFloat(info.format?.duration || vs?.duration || '0') || 0;
  return {
    width, height, duration,
    hasAudio: streams.some(s => s.codec_type === 'audio'),
    aspectRatio: aspectOf({ width, height })
  };
}

// ---- audio for Whisper ------------------------------------------------------

/**
 * Pull the speech track out as mono 16 kHz 32 kbps MP3 (~0.24 MB a minute),
 * so a large video becomes a small upload. Whisper only needs speech quality.
 */
export async function extractAudio(inputPath, outputPath, { start = null, duration = null } = {}) {
  const args = ['-y', '-v', 'error'];
  if (start !== null) args.push('-ss', String(start));
  args.push('-i', inputPath);
  if (duration !== null) args.push('-t', String(duration));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', outputPath);
  await execFileAsync('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 });
  return outputPath;
}

/**
 * Split [0, duration) into chunks small enough for Whisper, given the size of
 * the whole compressed audio. Returns [{start, duration}] in seconds.
 */
export function planChunks(totalSeconds, totalBytes, maxBytes = WHISPER_MAX_BYTES) {
  if (!totalSeconds || totalBytes <= maxBytes) return [{ start: 0, duration: null }];
  const bytesPerSec = totalBytes / totalSeconds;
  const chunkSeconds = Math.max(30, Math.floor((maxBytes * 0.9) / bytesPerSec));
  const chunks = [];
  for (let start = 0; start < totalSeconds; start += chunkSeconds) {
    chunks.push({ start, duration: Math.min(chunkSeconds, totalSeconds - start) });
  }
  return chunks;
}

// ---- Whisper API ------------------------------------------------------------

/**
 * Transcribe an audio/video buffer with the OpenAI Whisper API.
 * Returns [{word, start, end}, …] (seconds). The buffer must be under 25 MB;
 * use transcribeFile() for anything that might be bigger.
 * Requires OPENAI_API_KEY in env.
 */
export async function transcribeAudio(buffer, contentType = 'audio/mpeg', filename = 'audio.mp3') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error(`Audio is ${(buffer.length / 1048576).toFixed(1)} MB; Whisper takes 25 MB max`);
  }

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

/**
 * Transcribe a video file of any size: extract compressed mono audio, and if
 * that is still over Whisper's limit, transcribe it in time chunks and shift
 * each chunk's word times back onto the full timeline.
 */
export async function transcribeFile(inputPath, { duration = null, workDir = null } = {}) {
  const dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'tta-audio-'));
  try {
    const fullAudio = path.join(dir, 'speech.mp3');
    await extractAudio(inputPath, fullAudio);
    const size = fs.statSync(fullAudio).size;
    const total = duration ?? (await probeVideo(fullAudio)).duration;
    const chunks = planChunks(total, size);

    if (chunks.length === 1) {
      return await transcribeAudio(fs.readFileSync(fullAudio), 'audio/mpeg', 'speech.mp3');
    }

    const words = [];
    for (let i = 0; i < chunks.length; i++) {
      const { start, duration: len } = chunks[i];
      const part = path.join(dir, `speech-${i}.mp3`);
      await extractAudio(fullAudio, part, { start, duration: len });
      const partWords = await transcribeAudio(fs.readFileSync(part), 'audio/mpeg', `speech-${i}.mp3`);
      fs.rmSync(part, { force: true });
      for (const w of partWords) words.push({ ...w, start: w.start + start, end: w.end + start });
    }
    return words;
  } finally {
    if (!workDir) fs.rmSync(dir, { recursive: true, force: true });
  }
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

/** Convert seconds to ASS timestamp h:mm:ss.cs (rounded on whole centiseconds). */
export function toASS(sec) {
  const total = Math.max(0, Math.round(sec * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

/** Group flat word list into lines, respecting maxWordsPerLine. */
function groupIntoLines(words, maxWords) {
  const lines = [];
  for (let i = 0; i < words.length; i += maxWords) lines.push(words.slice(i, i + maxWords));
  return lines;
}

/** Text shown for one word under a style (caps, punctuation, ASS-safe). */
function displayWord(word, style) {
  let display = String(word).trim();
  if (!style.punctuation) display = display.replace(/[.,!?;:…—–-]+$/g, '');
  if (style.allCaps) display = display.toUpperCase();
  // { } \ would be read as ASS override tags
  return display.replace(/[{}]/g, '').replace(/\\/g, '/');
}

/**
 * Build an ASS subtitle string with an active-word highlight.
 *
 * Each line shows maxWordsPerLine words. The line is written as one Dialogue
 * event per word: during word i's time only word i carries the active colour
 * ({\1c&HBBGGRR&}), the rest are in the text colour. Word i's event runs from
 * its start to the next word's start, so the line never blinks between words.
 *
 * style fields used: font, textColor, activeColor, outlineColor, outlineWidth,
 *   shadow, allCaps, punctuation, size, marginV, maxWordsPerLine
 * width/height: the video's display size; PlayRes keeps its aspect at a
 * 1080p reference height so style sizes mean the same on any resolution.
 */
export function buildASS(words, style, { width = 1920, height = 1080 } = {}) {
  if (!words.length) return '';

  const primaryColour = assColour(style.textColor);
  const activeColour  = assColour(style.activeColor);
  const outlineColour = assColour(style.outlineColor);
  const primaryTag    = assTagColour(style.textColor);
  const activeTag     = assTagColour(style.activeColor);
  const shadowDepth   = style.shadow ? 2 : 0;
  const marginV       = style.marginV || 100;
  const fontSize      = style.size || 72;
  const fontName      = style.font || 'Arial';
  const maxWords      = style.maxWordsPerLine || 5;
  const outlineWidth  = style.outlineWidth ?? 2;

  const aspect = aspectOf({ width, height });
  const playResY = REFERENCE_HEIGHT[aspect];
  const playResX = Math.round(playResY * (width / height));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColour},${activeColour},${outlineColour},&H00000000,${style.bold === false ? 0 : -1},0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogLines = [];
  for (const group of groupIntoLines(words, maxWords)) {
    const shown = group.map(w => displayWord(w.word, style));
    for (let i = 0; i < group.length; i++) {
      const start = group[i].start;
      let end = i < group.length - 1 ? group[i + 1].start : group[i].end;
      if (end <= start) end = start + 0.01;
      const text = shown
        .map((t, j) => (j === i ? `{\\1c${activeTag}}${t}{\\1c${primaryTag}}` : t))
        .filter(t => t !== '')
        .join(' ');
      dialogLines.push(`Dialogue: 0,${toASS(start)},${toASS(end)},Default,,0,0,0,,${text}`);
    }
  }

  return `${header}\n${dialogLines.join('\n')}\n`;
}

// ---- ffmpeg helpers ---------------------------------------------------------

async function ffmpegAvailable() {
  try { await execFileAsync('ffmpeg', ['-version']); return true; }
  catch { return false; }
}

// Fonts shipped in the Docker image (see Dockerfile). libass also finds
// anything fontconfig knows about.
export const FONTS_DIR = process.env.SUBTITLE_FONTS_DIR || '/usr/share/fonts/brand';

function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
}

/**
 * Burn an ASS file into a video, producing a new file at outputPath.
 * Source resolution and quality are preserved (libx264 -crf 16).
 * Threads are capped so a 4K phone clip fits in the Fly VM's memory.
 */
export async function burnSubtitles(inputPath, assPath, outputPath) {
  let filter = `ass='${escapeFilterPath(assPath)}'`;
  if (fs.existsSync(FONTS_DIR)) filter += `:fontsdir='${escapeFilterPath(FONTS_DIR)}'`;
  await execFileAsync('ffmpeg', [
    '-y', '-v', 'error', '-i', inputPath,
    '-vf', filter,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    '-threads', process.env.FFMPEG_THREADS || '2',
    '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart',
    outputPath
  ], { maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Extract a preview frame (mid-point) from a video.
 * Returns the frame as a Buffer (JPEG).
 */
export async function extractPreviewFrame(videoPath, duration = null) {
  const total = duration ?? (await probeVideo(videoPath)).duration ?? 10;
  const midpoint = ((total || 10) / 2).toFixed(2);

  const tmpOut = path.join(os.tmpdir(), `tta-preview-${crypto.randomBytes(6).toString('hex')}.jpg`);
  await execFileAsync('ffmpeg', [
    '-y', '-v', 'error', '-ss', midpoint, '-i', videoPath,
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
 *   rawStyle      - the brand's style object from users.json (resolved here
 *                   for the clip's real orientation)
 *   style         - an already-resolved style (overrides rawStyle)
 *   vocabulary    - [{find, replace}, …]
 *   aspectRatio   - 'landscape' | 'portrait' (default: probed from the file)
 *   filename      - original filename hint
 *   transcribe    - optional (inputPath, {duration}) => words, for tests
 * @returns {{ videoBuffer: Buffer, assContent: string, srtContent: string,
 *              previewBuffer: Buffer, words: Array, aspectRatio: string }}
 */
export async function processVideo(videoBuffer, contentType, {
  rawStyle = null,
  style = null,
  vocabulary = [],
  aspectRatio = null,
  filename = 'video.mp4',
  transcribe = transcribeFile
} = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-subs-'));
  const ext = contentType.includes('quicktime') || /\.mov$/i.test(filename) ? '.mov' : '.mp4';
  const inputPath  = path.join(tmpDir, `input${ext}`);
  const assPath    = path.join(tmpDir, 'subs.ass');
  const outputPath = path.join(tmpDir, 'burned.mp4');

  try {
    fs.writeFileSync(inputPath, videoBuffer);

    // 1. Probe display size (rotation applied) and orientation
    let info = { width: 1920, height: 1080, duration: 0, hasAudio: true, aspectRatio: 'landscape' };
    try { info = await probeVideo(inputPath); } catch { /* keep defaults */ }
    if (aspectRatio) info.aspectRatio = aspectRatio;
    if (!info.hasAudio) throw new Error('video has no audio track to caption');
    const finalStyle = style || resolveStyle(rawStyle, info.aspectRatio);

    // 2. Transcribe (compressed audio, chunked if needed)
    const rawWords = await transcribe(inputPath, { duration: info.duration, workDir: tmpDir });
    if (!rawWords.length) throw new Error('no speech found to caption');

    // 3. Vocabulary find-replace
    const words = applyVocabulary(rawWords, vocabulary);

    // 4. Build ASS
    const assContent = buildASS(words, finalStyle, { width: info.width, height: info.height });
    fs.writeFileSync(assPath, assContent);

    // 5. SRT export
    const srtContent = wordsToSrt(words, finalStyle);

    // 6. Burn in
    await burnSubtitles(inputPath, assPath, outputPath);
    const burnedBuffer = fs.readFileSync(outputPath);

    // 7. Preview frame
    const previewBuffer = await extractPreviewFrame(outputPath, info.duration || null);

    return { videoBuffer: burnedBuffer, assContent, srtContent, previewBuffer, words, aspectRatio: info.aspectRatio };
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

export function srtTime(sec) {
  const total = Math.max(0, Math.round(sec * 1000));
  const ms = total % 1000;
  const s  = Math.floor(total / 1000) % 60;
  const m  = Math.floor(total / 60000) % 60;
  const h  = Math.floor(total / 3600000);
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
