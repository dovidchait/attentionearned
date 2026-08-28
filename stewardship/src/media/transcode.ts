import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { CHANNEL_SPECS, type MediaChannel, type MediaKind } from './specs.js';

const execFileAsync = promisify(execFile);

export interface RenditionResult {
  outputPath: string; // temp file — caller must store and delete
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export class TranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscodeError';
  }
}

/** Returns true if the ffmpeg binary is available on PATH. */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Transcode a local file for a given channel and kind.
 * Returns a temp file path — caller is responsible for storing to StorageBackend and cleaning up.
 */
export async function transcodeForChannel(
  inputPath: string,
  channel: MediaChannel,
  kind: MediaKind,
): Promise<RenditionResult> {
  if (kind === 'image') {
    return transcodeImage(inputPath, channel);
  }
  if (kind === 'video') {
    if (channel !== 'whatsapp') {
      throw new TranscodeError(`Video not supported for channel: ${channel}`);
    }
    return transcodeVideo(inputPath);
  }
  throw new TranscodeError(`Unsupported kind: ${kind}`);
}

async function transcodeImage(inputPath: string, channel: MediaChannel): Promise<RenditionResult> {
  const spec = channel === 'whatsapp' ? CHANNEL_SPECS.whatsapp.image : CHANNEL_SPECS.email.image;
  const outputPath = join(tmpdir(), `${randomUUID()}.jpg`);

  // Start at quality 85, step down to 60 if still over limit
  const qualities = [85, 72, 60];
  let lastBytes = 0;

  for (const quality of qualities) {
    await sharp(inputPath)
      .resize({ width: spec.maxWidth, height: spec.maxHeight, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toFile(outputPath);

    const { size } = await stat(outputPath);
    lastBytes = size;

    if (size <= spec.maxBytes) {
      const meta = await sharp(outputPath).metadata();
      return {
        outputPath,
        bytes: size,
        mime: spec.mime,
        width: meta.width,
        height: meta.height,
      };
    }
  }

  // Try progressive JPEG at quality 50 as last resort
  await sharp(inputPath)
    .resize({ width: spec.maxWidth, height: spec.maxHeight, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 50, progressive: true })
    .toFile(outputPath);

  const { size } = await stat(outputPath);
  if (size > spec.maxBytes) {
    await unlink(outputPath).catch(() => {});
    throw new TranscodeError(
      `Image cannot be compressed to ${spec.maxBytes} bytes for ${channel}. ` +
      `Final size: ${size} bytes.`,
    );
  }

  const meta = await sharp(outputPath).metadata();
  return { outputPath, bytes: size, mime: spec.mime, width: meta.width, height: meta.height };
}

async function transcodeVideo(inputPath: string): Promise<RenditionResult> {
  const spec = CHANNEL_SPECS.whatsapp.video;
  const outputPath = join(tmpdir(), `${randomUUID()}.mp4`);

  // Target bitrate calculation: leave 5% headroom below the limit
  const targetBytes = Math.floor(spec.maxBytes * 0.95);
  // Get video duration first to calculate bitrate
  const durationSec = await getVideoDurationSec(inputPath);
  // Total bitrate budget (bits/sec). Reserve 64kbps for audio.
  const totalKbps = Math.floor((targetBytes * 8) / durationSec / 1000);
  const videKbps = Math.max(totalKbps - 64, 200); // floor at 200kbps video

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-b:v', `${videKbps}k`,
    '-maxrate', `${videKbps * 2}k`,
    '-bufsize', `${videKbps * 4}k`,
    '-vf', `scale='min(${spec.maxWidth},iw)':'min(${spec.maxHeight},ih)':force_original_aspect_ratio=decrease`,
    '-c:a', 'aac',
    '-b:a', '64k',
    '-movflags', '+faststart',
    outputPath,
  ]);

  const { size } = await stat(outputPath);

  if (size > spec.maxBytes) {
    await unlink(outputPath).catch(() => {});
    throw new TranscodeError(
      `Video cannot be transcoded to ${spec.maxBytes} bytes. Final size: ${size} bytes.`,
    );
  }

  const finalDurationMs = Math.round(durationSec * 1000);
  return { outputPath, bytes: size, mime: spec.mime, durationMs: finalDurationMs };
}

async function getVideoDurationSec(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    inputPath,
  ]);
  const info = JSON.parse(stdout) as { format?: { duration?: string } };
  const dur = parseFloat(info.format?.duration ?? '0');
  if (!dur || dur <= 0) throw new TranscodeError(`Could not determine video duration for: ${inputPath}`);
  return dur;
}
