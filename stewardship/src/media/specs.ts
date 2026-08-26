export type MediaChannel = 'whatsapp' | 'email';
export type MediaKind = 'image' | 'video' | 'audio';

export interface ChannelImageSpec {
  maxBytes: number;
  mime: 'image/jpeg';
  maxWidth: number;
  maxHeight: number;
}

export interface ChannelVideoSpec {
  maxBytes: number;
  mime: 'video/mp4';
  maxWidth: number;
  maxHeight: number;
}

export const CHANNEL_SPECS = {
  whatsapp: {
    image: {
      maxBytes: 5 * 1024 * 1024,  // 5 MB
      mime: 'image/jpeg' as const,
      maxWidth: 1600,
      maxHeight: 1600,
    },
    video: {
      maxBytes: 16 * 1024 * 1024, // 16 MB
      mime: 'video/mp4' as const,
      maxWidth: 1280,
      maxHeight: 720,
    },
  },
  email: {
    image: {
      maxBytes: 1 * 1024 * 1024,  // 1 MB
      mime: 'image/jpeg' as const,
      maxWidth: 1200,
      maxHeight: 1200,
    },
  },
} as const;

export function supportsKind(channel: MediaChannel, kind: MediaKind): boolean {
  if (channel === 'whatsapp') return kind === 'image' || kind === 'video';
  if (channel === 'email') return kind === 'image';
  return false;
}
