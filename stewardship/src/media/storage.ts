import { copyFile, mkdir, stat } from 'fs/promises';
import { resolve, dirname, basename, extname } from 'path';
import { env } from '../lib/env.js';

export interface StorageBackend {
  /** Store a local file at the given key, return a URI usable as original_uri or rendition URI. */
  store(localPath: string, key: string): Promise<string>;
  /** Given a URI returned by store(), return an absolute local path for reading/transcoding. */
  resolve(uri: string): Promise<string>;
}

/**
 * Local filesystem backend — stores under MEDIA_DIR.
 * No cloud credentials needed. The StorageBackend interface is the seam
 * for adding Google Drive / S3 / Dropbox later as separate implementations.
 */
export class LocalStorage implements StorageBackend {
  private readonly root: string;

  constructor(mediaDir?: string) {
    this.root = resolve(mediaDir ?? env.MEDIA_DIR);
  }

  async store(localPath: string, key: string): Promise<string> {
    const dest = resolve(this.root, key);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(localPath, dest);
    return `file://${dest}`;
  }

  async resolve(uri: string): Promise<string> {
    if (uri.startsWith('file://')) {
      return uri.slice('file://'.length);
    }
    // For http(s) URIs, caller is responsible for downloading. This backend
    // only handles local file:// URIs — remote URIs are passed through as-is
    // for channel adapters that can fetch them directly.
    throw new Error(`LocalStorage cannot resolve non-file URI: ${uri}`);
  }
}

let _defaultStorage: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (!_defaultStorage) {
    _defaultStorage = new LocalStorage();
  }
  return _defaultStorage;
}

/** Build a storage key for a given asset. Namespaced by orgId to prevent collisions. */
export function makeStorageKey(orgId: string, category: 'originals' | 'renditions', filename: string): string {
  return `orgs/${orgId}/${category}/${filename}`;
}
