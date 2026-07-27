import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { cloneRepo } from '../src/fleet/clone.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
const tempDirs: string[] = [];
afterAll(() => {
  fixtures.forEach((f) => f.cleanup());
  tempDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'unrot-clone-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('cloneRepo', () => {
  it('shallow-clones a repo into the destination', async () => {
    const source = makeRepo({}, { commits: [{ files: { 'CLAUDE.md': '# hi\n' }, daysAgo: 1 }] });
    fixtures.push(source);
    const dest = join(tempDir(), 'clone');
    await cloneRepo(pathToFileURL(source.root).href, dest);
    expect(existsSync(join(dest, 'CLAUDE.md'))).toBe(true);
  });

  it('rejects with git stderr in the message for a bad URL', async () => {
    const dest = join(tempDir(), 'clone');
    await expect(cloneRepo(pathToFileURL('/no/such/repo-xyz').href, dest)).rejects.toThrow(
      /clone failed/i,
    );
  });
});
