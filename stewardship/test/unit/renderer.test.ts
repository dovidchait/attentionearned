import { describe, it, expect } from 'vitest';
import { renderTemplate, RenderError } from '../../src/channels/renderer.js';

describe('renderTemplate', () => {
  it('replaces a single slot', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'Dovid' })).toBe('Hello Dovid!');
  });

  it('replaces multiple slots', () => {
    expect(renderTemplate(
      'Dear {{first_name}}, your gift of {{amount}} changed lives.',
      { first_name: 'Rivka', amount: '$36' },
    )).toBe('Dear Rivka, your gift of $36 changed lives.');
  });

  it('replaces the same slot appearing twice', () => {
    expect(renderTemplate('{{x}} and {{x}}', { x: 'foo' })).toBe('foo and foo');
  });

  it('returns the body unchanged when there are no slots', () => {
    expect(renderTemplate('No slots here.', {})).toBe('No slots here.');
  });

  it('returns the body unchanged when variables map has extra keys', () => {
    expect(renderTemplate('Hello!', { unused: 'value' })).toBe('Hello!');
  });

  it('throws RenderError when a slot references a missing variable', () => {
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow(RenderError);
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow('{{name}}');
  });

  it('throws RenderError naming the missing key', () => {
    const err = (() => {
      try { renderTemplate('{{a}} {{b}}', { a: 'ok' }); }
      catch (e) { return e as RenderError; }
    })();
    expect(err).toBeInstanceOf(RenderError);
    expect(err.message).toContain('{{b}}');
  });

  it('handles empty string values correctly', () => {
    expect(renderTemplate('{{prefix}}Hello', { prefix: '' })).toBe('Hello');
  });

  it('does not touch slots with spaces (not valid {{var}} syntax)', () => {
    expect(renderTemplate('{{ not_a_slot }}', {})).toBe('{{ not_a_slot }}');
  });
});
