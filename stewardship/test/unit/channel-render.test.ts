import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../src/channels/render.js';

describe('renderTemplate', () => {
  it('substitutes all declared variables', () => {
    const result = renderTemplate(
      'Hello {{first_name}}, your gift of {{amount}} is appreciated.',
      ['first_name', 'amount'],
      { first_name: 'Sara', amount: '$54' },
    );
    expect(result).toBe('Hello Sara, your gift of $54 is appreciated.');
  });

  it('throws when a declared variable is missing from values', () => {
    expect(() =>
      renderTemplate('Hello {{name}}', ['name', 'amount'], { name: 'Chana' }),
    ).toThrow('Missing template variable: amount');
  });

  it('throws when body references an undeclared variable', () => {
    expect(() =>
      renderTemplate('Hello {{name}} {{surprise}}', ['name'], { name: 'Moshe' }),
    ).toThrow('Unknown template variable in body: surprise');
  });

  it('handles a body with no variables', () => {
    const result = renderTemplate('Thank you!', [], {});
    expect(result).toBe('Thank you!');
  });

  it('handles multiple occurrences of the same variable', () => {
    const result = renderTemplate('{{org}}, from {{org}} with love.', ['org'], { org: 'Chabad' });
    expect(result).toBe('Chabad, from Chabad with love.');
  });
});
