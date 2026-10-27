// Tests for the subtitle pipeline (unit tests — no network, no ffmpeg required)
// Run: npm test  (node's built-in test runner)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  resolveStyle,
  STYLE_DEFAULTS,
  buildASS,
  wordsToSrt,
  applyVocabulary,
  hexToAss,
  assTagColour,
  toASS,
  srtTime,
  displaySize,
  aspectOf,
  planChunks,
  WHISPER_MAX_BYTES,
  transcribeFile,
  processVideo,
} from '../lib/subtitles.js';

// David's own look is data on his own users.json entry, not code.
const USERS = JSON.parse(fs.readFileSync(new URL('../users.json', import.meta.url), 'utf8')).users;
const DAVID_PRESET = USERS.find(u => u.name === 'David Chait').subtitles.style;

import { parseCommand } from '../lib/commands.js';

// ---- resolveStyle -----------------------------------------------------------

test('resolveStyle: merges user style over defaults, picks correct aspect dims', () => {
  const style = resolveStyle({ font: 'Lilita One', textColor: '#FBF8F1', allCaps: true }, 'landscape');
  assert.equal(style.font, 'Lilita One');
  assert.equal(style.textColor, '#FBF8F1');
  assert.equal(style.allCaps, true);
  // landscape dims from defaults when not overridden
  assert.equal(style.size, 72);
  assert.equal(style.marginV, 100);
});

test('resolveStyle: per-aspect dims override defaults', () => {
  const raw = {
    landscape: { size: 84, marginV: 190, maxWordsPerLine: 4 },
    portrait:  { size: 92, marginV: 430, maxWordsPerLine: 3 }
  };
  const ls = resolveStyle(raw, 'landscape');
  assert.equal(ls.size, 84);
  assert.equal(ls.marginV, 190);
  assert.equal(ls.maxWordsPerLine, 4);

  const pt = resolveStyle(raw, 'portrait');
  assert.equal(pt.size, 92);
  assert.equal(pt.marginV, 430);
  assert.equal(pt.maxWordsPerLine, 3);
});

test('David\'s users.json style has the values from the issue', () => {
  assert.equal(DAVID_PRESET.font, 'Lilita One');
  assert.equal(DAVID_PRESET.textColor, '#FBF8F1');
  assert.equal(DAVID_PRESET.activeColor, '#FC2C30');
  assert.equal(DAVID_PRESET.outlineWidth, 7);
  assert.equal(DAVID_PRESET.allCaps, true);
  assert.equal(DAVID_PRESET.punctuation, false);
  assert.equal(DAVID_PRESET.landscape.maxWordsPerLine, 4);
  assert.equal(DAVID_PRESET.portrait.maxWordsPerLine, 3);
});

// ---- applyVocabulary --------------------------------------------------------

test('applyVocabulary: replaces matched words, leaves others alone', () => {
  const vocab = [{ find: 'Zernyo', replace: 'Zernio' }];
  const words = [
    { word: 'Hello', start: 0, end: 0.5 },
    { word: 'Zernyo', start: 0.5, end: 1.1 },
    { word: 'rocks', start: 1.1, end: 1.5 }
  ];
  const out = applyVocabulary(words, vocab);
  assert.equal(out[0].word, 'Hello');
  assert.equal(out[1].word, 'Zernio');
  assert.equal(out[2].word, 'rocks');
});

test('applyVocabulary: case-insensitive match', () => {
  const vocab = [{ find: 'zernio', replace: 'Zernio' }];
  const words = [{ word: 'ZERNIO', start: 0, end: 0.5 }];
  const out = applyVocabulary(words, vocab);
  assert.equal(out[0].word, 'Zernio');
});

test('applyVocabulary: empty vocabulary is a no-op', () => {
  const words = [{ word: 'Hello', start: 0, end: 0.5 }];
  assert.deepEqual(applyVocabulary(words, []), words);
});

// ---- buildASS ---------------------------------------------------------------

const SAMPLE_WORDS = [
  { word: 'Hello', start: 0.0, end: 0.5 },
  { word: 'world', start: 0.5, end: 1.0 },
  { word: 'this', start: 1.0, end: 1.3 },
  { word: 'is', start: 1.3, end: 1.5 },
  { word: 'a', start: 1.5, end: 1.6 },
  { word: 'test.', start: 1.6, end: 2.0 }
];

test('buildASS: produces a valid ASS file with script info and events sections', () => {
  const style = resolveStyle(DAVID_PRESET, 'landscape');
  const ass = buildASS(SAMPLE_WORDS, style);
  assert.ok(ass.includes('[Script Info]'));
  assert.ok(ass.includes('[V4+ Styles]'));
  assert.ok(ass.includes('[Events]'));
  assert.ok(ass.includes('Dialogue:'));
});

test('buildASS: allCaps uppercases words', () => {
  const style = resolveStyle({ allCaps: true, maxWordsPerLine: 10 });
  const ass = buildASS([{ word: 'hello', start: 0, end: 1 }], style);
  assert.ok(ass.includes('HELLO'));
  assert.ok(!ass.includes('}hello'));
});

test('buildASS: punctuation:false strips trailing punctuation', () => {
  const style = resolveStyle({ punctuation: false, maxWordsPerLine: 10 });
  const ass = buildASS([{ word: 'test.', start: 0, end: 1 }], style);
  assert.ok(!ass.includes('test.'));
  assert.ok(ass.includes('TEST') || ass.includes('test'));
});

test('buildASS: groups words into lines of maxWordsPerLine (one event per word)', () => {
  const style = resolveStyle({ maxWordsPerLine: 2, allCaps: false });
  const ass = buildASS(SAMPLE_WORDS, style);
  const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  assert.equal(dialogueLines.length, SAMPLE_WORDS.length);
  // each event shows only the 2 words of its line
  assert.ok(dialogueLines[0].endsWith('Hello{\\1c&HFFFFFF&} world'));
  assert.ok(dialogueLines[2].includes('this') && !dialogueLines[2].includes('world'));
});

test('buildASS: returns empty string for empty word list', () => {
  const style = resolveStyle({});
  assert.equal(buildASS([], style), '');
});

test('buildASS: PlayRes keeps the video aspect at the 1080p reference size', () => {
  const style = resolveStyle({});
  let ass = buildASS(SAMPLE_WORDS, style, { width: 1080, height: 1920 });
  assert.ok(ass.includes('PlayResX: 1080'));
  assert.ok(ass.includes('PlayResY: 1920'));
  // a 720p phone clip uses the same canvas, so size 84 looks the same
  ass = buildASS(SAMPLE_WORDS, style, { width: 1280, height: 720 });
  assert.ok(ass.includes('PlayResX: 1920'));
  assert.ok(ass.includes('PlayResY: 1080'));
  // a 4:3 clip keeps its own aspect (no stretched text)
  ass = buildASS(SAMPLE_WORDS, style, { width: 640, height: 480 });
  assert.ok(ass.includes('PlayResX: 1440'));
  assert.ok(ass.includes('PlayResY: 1080'));
});

test('buildASS: outlineWidth appears in the Style line', () => {
  const style = resolveStyle({ outlineWidth: 7 });
  const ass = buildASS(SAMPLE_WORDS, style);
  // Style: line includes outline value (comma-separated)
  const styleLine = ass.split('\n').find(l => l.startsWith('Style:'));
  assert.ok(styleLine);
  assert.ok(styleLine.includes(',7,'));
});

// ---- wordsToSrt -------------------------------------------------------------

test('wordsToSrt: produces numbered SRT entries', () => {
  const style = resolveStyle({ maxWordsPerLine: 3, allCaps: false, punctuation: true });
  const srt = wordsToSrt(SAMPLE_WORDS, style);
  assert.ok(srt.startsWith('1\n'));
  assert.ok(srt.includes(' --> '));
  assert.ok(srt.includes('Hello world this'));
});

test('wordsToSrt: allCaps and punctuation flags respected', () => {
  const style = resolveStyle({ allCaps: true, punctuation: false, maxWordsPerLine: 10 });
  const srt = wordsToSrt([{ word: 'hello.', start: 0, end: 1 }], style);
  assert.ok(srt.includes('HELLO'));
  assert.ok(!srt.includes('HELLO.'));
});

test('wordsToSrt: empty input returns empty string', () => {
  assert.equal(wordsToSrt([], {}), '');
});

// ---- parseCommand subtitles flag -------------------------------------------

test('parseCommand: "with subtitles" sets subtitles: true', () => {
  const cmd = parseCommand('', 'some caption\nwith subtitles\npost to instagram');
  assert.equal(cmd.subtitles, true);
});

test('parseCommand: "with captions" sets subtitles: true', () => {
  const cmd = parseCommand('', 'hello\nwith captions');
  assert.equal(cmd.subtitles, true);
});

test('parseCommand: "no subtitles" sets subtitles: false', () => {
  const cmd = parseCommand('', 'hello\nno subs');
  assert.equal(cmd.subtitles, false);
});

test('parseCommand: no subtitle keyword -> subtitles: null (use user default)', () => {
  const cmd = parseCommand('', 'hello world');
  assert.equal(cmd.subtitles, null);
});

// ---- per-brand styles -------------------------------------------------------

test('a client with no style gets the neutral default, never David\'s look', () => {
  for (const ar of ['landscape', 'portrait']) {
    const style = resolveStyle(undefined, ar);
    assert.equal(style.font, STYLE_DEFAULTS.font);
    assert.notEqual(style.font, 'Lilita One');
    assert.notEqual(String(style.textColor).toUpperCase(), '#FBF8F1');
    assert.notEqual(String(style.activeColor).toUpperCase(), '#FC2C30');
    const ass = buildASS(SAMPLE_WORDS, style);
    assert.ok(!ass.includes('Lilita One'));
    assert.ok(!ass.includes('3030FC')); // David's red in BGR
  }
});

test('two brands get two different looks', () => {
  const client = { font: 'Montserrat', textColor: '#FFFFFF', activeColor: '#2EC4B6' };
  const a = buildASS(SAMPLE_WORDS, resolveStyle(client, 'portrait'), { width: 1080, height: 1920 });
  const b = buildASS(SAMPLE_WORDS, resolveStyle(DAVID_PRESET, 'portrait'), { width: 1080, height: 1920 });
  assert.ok(a.includes('Style: Default,Montserrat,80,'));
  assert.ok(a.includes('{\\1c&HB6C42E&}'));
  assert.ok(b.includes('Style: Default,Lilita One,92,'));
  assert.ok(b.includes('{\\1c&H302CFC&}'));
});

test('David\'s style is only on his own users.json entry', () => {
  for (const u of USERS.filter(u => u.name !== 'David Chait')) {
    assert.notEqual(u.subtitles?.style?.font, 'Lilita One', `${u.name} must not use David's font`);
  }
});

// ---- colours ----------------------------------------------------------------

test('hexToAss: #RRGGBB -> &H00BBGGRR, alpha byte kept as hex', () => {
  assert.equal(hexToAss('#FC2C30'), '&H00302CFC');
  assert.equal(hexToAss('#FBF8F1'), '&H00F1F8FB');
  assert.equal(hexToAss('#80FF0000'), '&H800000FF');
  assert.equal(hexToAss('nonsense'), '&H00FFFFFF');
});

test('assTagColour: override tags use &HBBGGRR& (no alpha, closing &)', () => {
  assert.equal(assTagColour('#FC2C30'), '&H302CFC&');
  assert.equal(assTagColour('&H0000FFFF'), '&H00FFFF&');
});

// ---- karaoke highlight ------------------------------------------------------

function events(ass) {
  return ass.split('\n').filter(l => l.startsWith('Dialogue:')).map(l => {
    const parts = l.split(',');
    return { start: parts[1], end: parts[2], text: parts.slice(9).join(',') };
  });
}

test('karaoke: exactly one word is in the active colour in each event', () => {
  const style = resolveStyle({ textColor: '#FFFFFF', activeColor: '#FC2C30', maxWordsPerLine: 3 });
  const evs = events(buildASS(SAMPLE_WORDS, style));
  assert.equal(evs.length, SAMPLE_WORDS.length);
  evs.forEach((e, i) => {
    assert.equal((e.text.match(/\\1c&H302CFC&/g) || []).length, 1, `event ${i}`);
    // the highlighted word is the word being spoken
    const spoken = SAMPLE_WORDS[i].word;
    assert.ok(e.text.includes(`{\\1c&H302CFC&}${spoken}{\\1c&HFFFFFF&}`), e.text);
    // no \k tags (they fill words left to right instead of highlighting one)
    assert.ok(!/\\k/.test(e.text));
  });
});

test('karaoke: each word event runs from its start to the next word, no gaps in a line', () => {
  const words = [
    { word: 'one', start: 1.0, end: 1.2 },
    { word: 'two', start: 1.5, end: 1.9 },   // 0.3 s pause before it
    { word: 'three', start: 2.0, end: 2.6 }
  ];
  const evs = events(buildASS(words, resolveStyle({ maxWordsPerLine: 3 })));
  assert.deepEqual(evs.map(e => [e.start, e.end]), [
    ['0:00:01.00', '0:00:01.50'],
    ['0:00:01.50', '0:00:02.00'],
    ['0:00:02.00', '0:00:02.60']
  ]);
});

test('buildASS: braces in a transcript cannot inject ASS tags', () => {
  const evs = events(buildASS([{ word: '{\\fs200}big', start: 0, end: 1 }], resolveStyle({})));
  assert.ok(!evs[0].text.includes('\\fs200'));
});

test('timestamps round on whole centiseconds / milliseconds', () => {
  assert.equal(toASS(1.996), '0:00:02.00');
  assert.equal(toASS(59.999), '0:01:00.00');
  assert.equal(toASS(3723.456), '1:02:03.46');
  assert.equal(srtTime(1.9996), '00:00:02,000');
  assert.equal(srtTime(61.5), '00:01:01,500');
});

// ---- orientation ------------------------------------------------------------

test('displaySize: phone rotation swaps width and height', () => {
  assert.deepEqual(displaySize({ width: 1920, height: 1080 }), { width: 1920, height: 1080 });
  assert.deepEqual(displaySize({ width: 1920, height: 1080, tags: { rotate: '90' } }), { width: 1080, height: 1920 });
  assert.deepEqual(displaySize({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }), { width: 1080, height: 1920 });
  assert.equal(aspectOf(displaySize({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] })), 'portrait');
  assert.equal(aspectOf({ width: 1920, height: 1080 }), 'landscape');
});

// ---- Whisper 25 MB limit ----------------------------------------------------

test('planChunks: small audio is one request', () => {
  assert.deepEqual(planChunks(600, 2 * 1024 * 1024), [{ start: 0, duration: null }]);
});

test('planChunks: audio over the limit is split into chunks that each fit', () => {
  const total = 3 * 3600;                // 3 hours
  const bytes = 60 * 1024 * 1024;        // 60 MB of compressed audio
  const chunks = planChunks(total, bytes);
  assert.ok(chunks.length >= 3);
  const bytesPerSec = bytes / total;
  for (const c of chunks) assert.ok(c.duration * bytesPerSec < WHISPER_MAX_BYTES);
  assert.equal(chunks[0].start, 0);
  const last = chunks[chunks.length - 1];
  assert.ok(Math.abs(last.start + last.duration - total) < 1e-6);
});

// ---- ffmpeg integration (skipped when ffmpeg is not installed) --------------

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

function makeClip(dir, { width, height, seconds = 3, rotate = null }) {
  const out = path.join(dir, `clip-${width}x${height}.mp4`);
  const args = ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'];
  if (rotate === null) {
    execFileSync('ffmpeg', [...args, out]);
    return out;
  }
  // phones store portrait clips landscape + a rotation flag; set it on a remux
  const flat = path.join(dir, 'flat.mp4');
  execFileSync('ffmpeg', [...args, flat]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', flat, '-c', 'copy', '-metadata:s:v:0', `rotate=${rotate}`, out]);
  return out;
}

test('transcribeFile: sends compressed mono audio to Whisper, not the video', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-test-'));
  const clip = makeClip(dir, { width: 1280, height: 720, seconds: 4 });
  const realFetch = globalThis.fetch;
  const sent = [];
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  globalThis.fetch = async (url, opts) => {
    const file = opts.body.get('file');
    sent.push({ name: file.name, type: file.type, size: file.size });
    return new Response(JSON.stringify({ words: [{ word: 'hello', start: 0.5, end: 1.0 }] }), { status: 200 });
  };
  try {
    const words = await transcribeFile(clip);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'audio/mpeg');
    assert.ok(sent[0].size < fs.statSync(clip).size, 'audio upload is smaller than the video');
    assert.deepEqual(words, [{ word: 'hello', start: 0.5, end: 1.0 }]);
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('processVideo: burns captions into a rotated phone clip, portrait style, same size out', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-test-'));
  // stored 640x360 with a 90 degree rotation = displayed as 360x640 portrait
  const clip = makeClip(dir, { width: 640, height: 360, seconds: 3, rotate: 90 });
  try {
    const client = {
      font: 'DejaVu Sans', textColor: '#FFFFFF', activeColor: '#2EC4B6',
      landscape: { size: 60 }, portrait: { size: 70, marginV: 200, maxWordsPerLine: 2 }
    };
    const result = await processVideo(fs.readFileSync(clip), 'video/mp4', {
      rawStyle: client,
      transcribe: async () => [
        { word: 'Real', start: 0.2, end: 0.6 },
        { word: 'fathers', start: 0.6, end: 1.2 },
        { word: 'show', start: 1.4, end: 1.8 },
        { word: 'up', start: 1.8, end: 2.4 }
      ]
    });
    assert.equal(result.aspectRatio, 'portrait');
    assert.ok(result.assContent.includes('Style: Default,DejaVu Sans,70,'));
    assert.ok(result.assContent.includes('PlayResY: 1920'));
    assert.ok(result.videoBuffer.length > 1000);
    assert.equal(result.previewBuffer.slice(0, 2).toString('hex'), 'ffd8'); // JPEG
    const out = path.join(dir, 'out.mp4');
    fs.writeFileSync(out, result.videoBuffer);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', out]).toString());
    const vs = probe.streams.find(s => s.codec_type === 'video');
    const shown = displaySize(vs);
    assert.deepEqual([shown.width, shown.height], [360, 640]);
    assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
