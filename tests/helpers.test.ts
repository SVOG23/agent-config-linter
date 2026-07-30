import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('makeRepo', () => {
  // A repack racing the commit loop deletes loose objects the next commit still
  // references. It only ever bit the Linux runner, and cost far more to trace
  // than this assertion costs to keep.
  it('disables git auto-maintenance so a repack cannot race the commit loop', () => {
    const repo = makeRepo({}, { git: true });
    fixtures.push(repo);
    const config = (key: string): string =>
      execFileSync('git', ['-C', repo.root, 'config', '--get', key], {
        encoding: 'utf8',
      }).trim();
    expect(config('gc.auto')).toBe('0');
    expect(config('maintenance.auto')).toBe('false');
  });
});
