import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { transcodeForChannel, isFfmpegAvailable } from '../../src/media/transcode.js';
import { CHANNEL_SPECS } from '../../src/media/specs.js';

const execFileAsync = promisify(execFile);

// Synthetic test files created during setup
const tempFiles: string[] = [];

function tmp(ext: string): string {
  const p = join(tmpdir(), `transcode-test-${randomUUID()}${ext}`);
  tempFiles.push(p);
  return p;
}

afterAll(async () => {
  await Promise.all(tempFiles.map(f => unlink(f).catch(() => {})));
});

// ─── Image transcoding (sharp only, no ffmpeg needed) ────────────────────────

describe('transcodeForChannel — image (sharp)', () => {
  it('produces a WhatsApp-compliant JPEG from a synthetic image', async () => {
    const inputPath = tmp('.jpg');
    // 200×200 solid red JPEG — guaranteed to compress well under 5MB
    await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 50, b: 50 } } })
      .jpeg({ quality: 90 })
      .toFile(inputPath);

    const result = await transcodeForChannel(inputPath, 'whatsapp', 'image');
    tempFiles.push(result.outputPath);

    const spec = CHANNEL_SPECS.whatsapp.image;
    expect(result.mime).toBe(spec.mime);
    expect(result.bytes).toBeLessThanOrEqual(spec.maxBytes);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.width).toBeDefined();
    expect(result.height).toBeDefined();
    expect(result.width!).toBeLessThanOrEqual(spec.maxWidth);
    expect(result.height!).toBeLessThanOrEqual(spec.maxHeight);

    // Output file must exist and size must match reported bytes
    const { size } = await stat(result.outputPath);
    expect(size).toBe(result.bytes);
  });

  it('produces an email-compliant JPEG from a synthetic image', async () => {
    const inputPath = tmp('.jpg');
    await sharp({ create: { width: 150, height: 150, channels: 3, background: { r: 50, g: 150, b: 200 } } })
      .jpeg({ quality: 90 })
      .toFile(inputPath);

    const result = await transcodeForChannel(inputPath, 'email', 'image');
    tempFiles.push(result.outputPath);

    const spec = CHANNEL_SPECS.email.image;
    expect(result.mime).toBe(spec.mime);
    expect(result.bytes).toBeLessThanOrEqual(spec.maxBytes);
    expect(result.width!).toBeLessThanOrEqual(spec.maxWidth);
    expect(result.height!).toBeLessThanOrEqual(spec.maxHeight);
  });

  it('downscales an oversized image to fit within channel dimensions', async () => {
    const inputPath = tmp('.jpg');
    // 3000×2000 — wider than WhatsApp's 1600px limit
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 100, g: 200, b: 100 } } })
      .jpeg({ quality: 80 })
      .toFile(inputPath);

    const result = await transcodeForChannel(inputPath, 'whatsapp', 'image');
    tempFiles.push(result.outputPath);

    expect(result.width!).toBeLessThanOrEqual(CHANNEL_SPECS.whatsapp.image.maxWidth);
    expect(result.height!).toBeLessThanOrEqual(CHANNEL_SPECS.whatsapp.image.maxHeight);
  });
});

// ─── Video transcoding (requires ffmpeg) ─────────────────────────────────────

describe('transcodeForChannel — video (ffmpeg)', () => {
  it('skips gracefully when ffmpeg is not available', async () => {
    const hasFfmpeg = await isFfmpegAvailable();
    if (hasFfmpeg) {
      // ffmpeg IS available — run a real transcode test instead of skipping
      const inputPath = tmp('.mp4');
      // Create a 1-second synthetic black MP4 via ffmpeg
      await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'color=black:size=320x240:rate=1:duration=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', '1',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac',
        inputPath,
      ]);

      const result = await transcodeForChannel(inputPath, 'whatsapp', 'video');
      tempFiles.push(result.outputPath);

      const spec = CHANNEL_SPECS.whatsapp.video;
      expect(result.mime).toBe(spec.mime);
      expect(result.bytes).toBeLessThanOrEqual(spec.maxBytes);
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.durationMs).toBeDefined();
      expect(result.durationMs!).toBeGreaterThan(0);

      const { size } = await stat(result.outputPath);
      expect(size).toBe(result.bytes);
    } else {
      // ffmpeg not available — this is acceptable in constrained CI environments
      console.log('Skipping video transcode test — ffmpeg not available');
      expect(true).toBe(true); // explicit no-op pass
    }
  });

  it('throws TranscodeError for video on email channel', async () => {
    const { TranscodeError } = await import('../../src/media/transcode.js');
    const inputPath = tmp('.mp4');
    // Write a placeholder file (content doesn't matter — error is thrown before reading it)
    await writeFile(inputPath, Buffer.alloc(0));

    await expect(transcodeForChannel(inputPath, 'email', 'video')).rejects.toThrow(TranscodeError);
  });
});
