import { describe, it, expect } from 'vitest';
import { CHANNEL_SPECS, supportsKind } from '../../src/media/specs.js';

describe('Channel specs', () => {
  it('WhatsApp image limit is 5MB', () => {
    expect(CHANNEL_SPECS.whatsapp.image.maxBytes).toBe(5 * 1024 * 1024);
  });

  it('WhatsApp video limit is 16MB', () => {
    expect(CHANNEL_SPECS.whatsapp.video.maxBytes).toBe(16 * 1024 * 1024);
  });

  it('email image limit is 1MB', () => {
    expect(CHANNEL_SPECS.email.image.maxBytes).toBe(1 * 1024 * 1024);
  });

  it('WhatsApp image MIME is image/jpeg', () => {
    expect(CHANNEL_SPECS.whatsapp.image.mime).toBe('image/jpeg');
  });

  it('WhatsApp video MIME is video/mp4', () => {
    expect(CHANNEL_SPECS.whatsapp.video.mime).toBe('video/mp4');
  });

  it('email image MIME is image/jpeg', () => {
    expect(CHANNEL_SPECS.email.image.mime).toBe('image/jpeg');
  });
});

describe('supportsKind', () => {
  it('WhatsApp supports images', () => expect(supportsKind('whatsapp', 'image')).toBe(true));
  it('WhatsApp supports video', () => expect(supportsKind('whatsapp', 'video')).toBe(true));
  it('WhatsApp does not support audio', () => expect(supportsKind('whatsapp', 'audio')).toBe(false));
  it('email supports images', () => expect(supportsKind('email', 'image')).toBe(true));
  it('email does not support video', () => expect(supportsKind('email', 'video')).toBe(false));
  it('email does not support audio', () => expect(supportsKind('email', 'audio')).toBe(false));
});
