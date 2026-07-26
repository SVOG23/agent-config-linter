import { describe, expect, it } from 'vitest';
import { colorize } from '../src/colors.js';

describe('colorize', () => {
  it('emits ANSI codes when enabled', () => {
    const c = colorize(true);
    expect(c.red('x')).toBe('[31mx[39m');
    expect(c.bold('x')).toBe('[1mx[22m');
  });

  it('passes text through when disabled', () => {
    const c = colorize(false);
    expect(c.red('x')).toBe('x');
    expect(c.dim('y')).toBe('y');
  });
});
