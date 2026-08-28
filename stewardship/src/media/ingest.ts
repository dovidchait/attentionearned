import { stat } from 'fs/promises';
import { unlink } from 'fs/promises';
import { extname, basename } from 'path';
import { randomUUID } from 'crypto';
import { db } from '../lib/db.js';
import { mediaAssets, mediaRenditions } from '../schema/index.js';
import { getStorage, makeStorageKey } from './storage.js';
import { transcodeForChannel, isFfmpegAvailable } from './transcode.js';
import { supportsKind, type MediaChannel, type MediaKind } from './specs.js';
import type { MediaAsset } from '../schema/media.js';

interface IngestOptions {
  /** Space-separated tags e.g. ['seasonal:chanukah', 'no_faces'] */
  tags?: string[];
  designationId?: string;
  capturedAt?: Date;
  expiresAt?: Date;
}

/**
 * Ingest a local file (or register an existing remote URI) as a media asset.
 *
 * - Uploads original to storage backend
 * - Creates media_assets row (releaseOnFile=false, taggingState='untagged' by default)
 * - Transcodes and stores renditions for supported channels
 *
 * The caller is responsible for setting releaseOnFile=true via confirmRelease()
 * before the asset is eligible for selection.
 */
export async function ingestAsset(
  input: string, // local file path OR an https:// URI for already-hosted media
  orgId: string,
  options: IngestOptions = {},
): Promise<MediaAsset> {
  const storage = getStorage();
  const assetId = randomUUID();
  const isRemoteUri = input.startsWith('http://') || input.startsWith('https://');

  let originalUri: string;
  let originalBytes: number | undefined;
  let mime: string | undefined;
  let kind: MediaKind;

  if (isRemoteUri) {
    // Register an already-hosted file — no upload needed
    originalUri = input;
    kind = guessKindFromUrl(input);
  } else {
    // Local file — upload to storage
    const fileInfo = await stat(input);
    originalBytes = fileInfo.size;
    kind = guessKindFromPath(input);
    const ext = extname(input) || '.bin';
    const storageKey = makeStorageKey(orgId, 'originals', `${assetId}${ext}`);
    originalUri = await storage.store(input, storageKey);
  }

  mime = guessMime(input, kind);

  // Insert media_assets row
  const [asset] = await db.insert(mediaAssets).values({
    id: assetId,
    orgId,
    kind,
    originalUri,
    originalBytes,
    mime,
    capturedAt: options.capturedAt,
    expiresAt: options.expiresAt,
    designationId: options.designationId,
    tags: options.tags ?? [],
    releaseOnFile: false, // explicit — must be confirmed separately
    taggingState: 'untagged',
  }).returning();

  // Transcode renditions for each supported channel (best-effort — log but don't fail)
  if (!isRemoteUri) {
    const ffmpegAvailable = kind === 'video' ? await isFfmpegAvailable() : true;

    for (const channel of ['whatsapp', 'email'] as MediaChannel[]) {
      if (!supportsKind(channel, kind)) continue;
      if (kind === 'video' && !ffmpegAvailable) {
        console.warn(`ffmpeg not available — skipping video rendition for ${channel}`);
        continue;
      }

      let renditionPath: string | null = null;
      try {
        const rendition = await transcodeForChannel(input, channel, kind);
        renditionPath = rendition.outputPath;

        const renditionKey = makeStorageKey(orgId, 'renditions', `${assetId}-${channel}.${kind === 'video' ? 'mp4' : 'jpg'}`);
        const uri = await storage.store(renditionPath, renditionKey);

        await db.insert(mediaRenditions).values({
          assetId,
          channel,
          uri,
          bytes: rendition.bytes,
          mime: rendition.mime,
          width: rendition.width,
          height: rendition.height,
          durationMs: rendition.durationMs,
          specVersion: 'v1',
        });
      } catch (err) {
        console.error(`Transcode failed for ${channel}: ${(err as Error).message}`);
      } finally {
        if (renditionPath) await unlink(renditionPath).catch(() => {});
      }
    }
  }

  return asset;
}

function guessKindFromPath(filePath: string): MediaKind {
  const ext = extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'].includes(ext)) return 'video';
  if (['.mp3', '.m4a', '.aac', '.wav', '.ogg'].includes(ext)) return 'audio';
  return 'image'; // safe default
}

function guessKindFromUrl(url: string): MediaKind {
  return guessKindFromPath(url.split('?')[0]);
}

function guessMime(input: string, kind: MediaKind): string {
  const ext = extname(input.split('?')[0]).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4v': 'video/mp4',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  };
  return mimeMap[ext] ?? (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');
}
