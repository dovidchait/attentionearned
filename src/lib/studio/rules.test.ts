import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captionKeyFor,
  groupByCaption,
  isSubmissionId,
  MAX_CAPTION_CHARS,
  postBelongsToProfile,
  readSettings,
  safeFilename,
  safeStudioPath,
  toCalendarPost,
  validateMedia,
  validatePresign,
  validateSchedule,
  validateSettings,
  validateTargets,
} from './rules.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const ACCOUNT = '65f0a1b2c3d4e5f6a7b8c9d0';
const OTHER_ACCOUNT = '65f0a1b2c3d4e5f6a7b8c9d1';

test('safeFilename keeps only a plain basename', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('my clip (final).mp4'), 'my_clip_final_.mp4');
  assert.equal(safeFilename('...'), 'upload');
});

test('validatePresign accepts video and image types and rejects everything else', () => {
  const ok = validatePresign({ filename: 'a.mp4', contentType: 'video/mp4', size: 1000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.kind, 'video');

  assert.equal(validatePresign({ filename: 'a.exe', contentType: 'application/x-msdownload', size: 1 }).ok, false);
  assert.equal(validatePresign({ filename: 'a.mp4', contentType: 'video/mp4', size: 0 }).ok, false);
  assert.equal(validatePresign({ filename: 'a.mp4', contentType: 'video/mp4', size: 1.5 }).ok, false);
  assert.equal(validatePresign({ filename: 'a.mp4', contentType: 'video/mp4', size: 2 ** 31 }).ok, false);
  assert.equal(validatePresign(null).ok, false);
});

test('validateSettings trims text, enforces limits and normalises campaign day', () => {
  const ok = validateSettings({ orgName: '  Chai Lifeline  ', voiceTone: '', currentCampaign: '', campaignDay: '5' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.value, { orgName: 'Chai Lifeline', voiceTone: '', currentCampaign: '', campaignDay: 5 });

  const blankDay = validateSettings({ orgName: 'X', campaignDay: '' });
  assert.equal(blankDay.ok && blankDay.value.campaignDay, null);

  assert.equal(validateSettings({ orgName: 'x'.repeat(101) }).ok, false);
  assert.equal(validateSettings({ campaignDay: 31 }).ok, false);
  assert.equal(validateSettings({ campaignDay: 2.5 }).ok, false);
  assert.equal(validateSettings('not an object').ok, false);
});

test('readSettings falls back to empty settings for unreadable stored data', () => {
  assert.deepEqual(readSettings({ campaignDay: 99 }), {
    orgName: '',
    voiceTone: '',
    currentCampaign: '',
    campaignDay: null,
  });
  assert.deepEqual(readSettings(undefined).orgName, '');
});

test('validateTargets requires ids and captions and caps caption length', () => {
  const good = validateTargets([{ accountId: ACCOUNT, caption: '  hello  ' }]);
  assert.deepEqual(good.ok && good.value, [{ accountId: ACCOUNT, caption: 'hello' }]);

  assert.equal(validateTargets([]).ok, false);
  assert.equal(validateTargets([{ accountId: 'has spaces here', caption: 'x' }]).ok, false);
  assert.equal(validateTargets([{ accountId: ACCOUNT, caption: '   ' }]).ok, false);
  assert.equal(validateTargets([{ accountId: ACCOUNT, caption: 'x'.repeat(MAX_CAPTION_CHARS + 1) }]).ok, false);
});

test('groupByCaption posts identical captions together and keeps first-seen order', () => {
  const groups = groupByCaption([
    { caption: 'A', accountId: '1' },
    { caption: 'B', accountId: '2' },
    { caption: 'A', accountId: '3' },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.caption, g.items.map((i) => i.accountId)]),
    [
      ['A', ['1', '3']],
      ['B', ['2']],
    ],
  );
});

test('validateMedia only accepts https URLs with a known media type', () => {
  assert.equal(validateMedia({ url: 'https://cdn.example.com/clip.mp4', type: 'video' }).ok, true);
  assert.equal(validateMedia({ url: 'http://cdn.example.com/clip.mp4', type: 'video' }).ok, false);
  assert.equal(validateMedia({ url: 'javascript:alert(1)', type: 'video' }).ok, false);
  assert.equal(validateMedia({ url: 'https://cdn.example.com/x', type: 'audio' }).ok, false);
});

test('validateSchedule handles post-now, future times, bounds and time zones', () => {
  assert.deepEqual(validateSchedule({ publishNow: true }, NOW), { ok: true, value: { publishNow: true } });

  const soon = validateSchedule({ scheduledFor: '2026-11-22T13:00:00Z', timezone: 'America/New_York' }, NOW);
  assert.deepEqual(soon.ok && soon.value, {
    publishNow: false,
    scheduledFor: '2026-11-22T13:00:00.000Z',
    timezone: 'America/New_York',
  });

  assert.equal(validateSchedule({ scheduledFor: '2026-11-22T11:00:00Z' }, NOW).ok, false, 'past time');
  assert.equal(validateSchedule({ scheduledFor: '2030-01-01T00:00:00Z' }, NOW).ok, false, 'too far ahead');
  assert.equal(validateSchedule({ scheduledFor: 'not a date' }, NOW).ok, false);
  assert.equal(validateSchedule({}, NOW).ok, false);

  const badZone = validateSchedule({ scheduledFor: '2026-11-22T13:00:00Z', timezone: 'Mars/Olympus' }, NOW);
  assert.equal(badZone.ok && badZone.value.publishNow === false && badZone.value.timezone, 'UTC');
});

test('postBelongsToProfile trusts profileId when Zernio returns it', () => {
  const mine = new Set([ACCOUNT]);
  assert.equal(postBelongsToProfile({ profileId: 'p1' }, 'p1', new Set()), true);
  assert.equal(postBelongsToProfile({ profileId: 'p2', platforms: [{ accountId: ACCOUNT }] }, 'p1', mine), false);
});

test('postBelongsToProfile falls back to account ownership and refuses anything unclear', () => {
  const mine = new Set([ACCOUNT]);
  assert.equal(postBelongsToProfile({ platforms: [{ accountId: ACCOUNT }] }, 'p1', mine), true);
  assert.equal(
    postBelongsToProfile({ platforms: [{ accountId: ACCOUNT }, { accountId: OTHER_ACCOUNT }] }, 'p1', mine),
    false,
    'one foreign account in the post is enough to refuse it',
  );
  assert.equal(postBelongsToProfile({ platforms: [] }, 'p1', mine), false);
  assert.equal(postBelongsToProfile({}, 'p1', mine), false);
});

test('toCalendarPost sorts statuses into upcoming and recent and blocks edits while in flight', () => {
  const draft = toCalendarPost({ _id: 'abc1', status: 'draft', content: 'hi', scheduledFor: '2026-12-01T00:00:00Z' });
  assert.equal(draft?.upcoming, true);
  assert.equal(draft?.editable, true);

  const published = toCalendarPost({ _id: 'abc2', status: 'published', publishedAt: '2026-11-01T00:00:00Z' });
  assert.equal(published?.upcoming, false);
  assert.equal(published?.editable, false);
  assert.equal(published?.when, '2026-11-01T00:00:00Z');

  const inFlight = toCalendarPost({ _id: 'abc3', status: 'processing', scheduledFor: '2026-11-22T13:00:00Z' });
  assert.equal(inFlight?.upcoming, true);
  assert.equal(inFlight?.editable, false);

  assert.equal(toCalendarPost({ status: 'draft' }), null, 'a post without an id is dropped');
});

test('safeStudioPath only returns Studio paths', () => {
  assert.equal(safeStudioPath('/studio/dashboard', '/fallback'), '/studio/dashboard');
  assert.equal(safeStudioPath('https://evil.example/studio', '/fallback'), '/fallback');
  assert.equal(safeStudioPath('//evil.example', '/fallback'), '/fallback');
  assert.equal(safeStudioPath('/studio/../admin', '/fallback'), '/fallback');
  assert.equal(safeStudioPath(null, '/fallback'), '/fallback');
});

test('captionKeyFor maps every platform to one of the three captions', () => {
  assert.equal(captionKeyFor('instagram'), 'instagram');
  assert.equal(captionKeyFor('facebook'), 'instagram');
  assert.equal(captionKeyFor('youtube'), 'instagram');
  assert.equal(captionKeyFor('twitter'), 'linkedin');
  assert.equal(captionKeyFor('tiktok'), 'tiktok');
});

test('isSubmissionId accepts UUID-style ids and rejects short or unsafe ones', () => {
  assert.equal(isSubmissionId('3f1c2b9e-7a4d-4e8f-9b2a-1c2d3e4f5a6b'), true);
  assert.equal(isSubmissionId('short'), false);
  assert.equal(isSubmissionId('../../../etc'), false);
});
