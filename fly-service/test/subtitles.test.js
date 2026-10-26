// Tests for the subtitle pipeline (unit tests — no network, no ffmpeg required)
// Run: npm test  (node's built-in test runner)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveStyle,
  DAVID_PRESET,
  buildASS,
  wordsToSrt,
  applyVocabulary,
} from '../lib/subtitles.js';

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

test('DAVID_PRESET has the expected values from the issue', () => {
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

test('buildASS: groups words into lines of maxWordsPerLine', () => {
  const style = resolveStyle({ maxWordsPerLine: 2, allCaps: false });
  const ass = buildASS(SAMPLE_WORDS, style);
  const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  assert.equal(dialogueLines.length, Math.ceil(SAMPLE_WORDS.length / 2));
});

test('buildASS: returns empty string for empty word list', () => {
  const style = resolveStyle({});
  assert.equal(buildASS([], style), '');
});

test('buildASS: PlayResX/Y set from width/height args', () => {
  const style = resolveStyle({});
  const ass = buildASS(SAMPLE_WORDS, style, { width: 1080, height: 1920 });
  assert.ok(ass.includes('PlayResX: 1080'));
  assert.ok(ass.includes('PlayResY: 1920'));
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
