import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTarget, sourcesFromDir, sourcesFromList } from '../src/fleet/targets.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('parseTarget', () => {
  it('parses gh: targets into an owner', () => {
    expect(parseTarget('gh:vercel', '/')).toEqual({ kind: 'github', owner: 'vercel' });
  });

  it('rejects an empty gh: owner', () => {
    expect(() => parseTarget('gh:', '/')).toThrow(/owner/i);
  });

  it('resolves a directory path to a dir target', () => {
    const repo = track(makeRepo({}));
    expect(parseTarget(repo.root, '/')).toEqual({ kind: 'dir', path: repo.root });
  });

  it('resolves a file path to a list target', () => {
    const repo = track(makeRepo({ 'repos.txt': 'octocat/hello-world\n' }));
    expect(parseTarget('repos.txt', repo.root)).toEqual({
      kind: 'list',
      path: join(repo.root, 'repos.txt'),
    });
  });

  it('rejects a target that does not exist', () => {
    expect(() => parseTarget('no/such/thing', '/')).toThrow(/no such/i);
  });
});

describe('sourcesFromList', () => {
  it('expands owner/repo lines to GitHub clone URLs and keeps full URLs', () => {
    const repo = track(
      makeRepo({
        'repos.txt': [
          '# comment',
          'octocat/hello-world',
          '',
          'https://gitlab.com/group/project.git',
          'git@github.com:owner/thing.git',
        ].join('\n'),
      }),
    );
    expect(sourcesFromList(join(repo.root, 'repos.txt'))).toEqual([
      { name: 'octocat/hello-world', url: 'https://github.com/octocat/hello-world.git' },
      { name: 'group/project', url: 'https://gitlab.com/group/project.git' },
      { name: 'owner/thing', url: 'git@github.com:owner/thing.git' },
    ]);
  });

  it('rejects an empty list', () => {
    const repo = track(makeRepo({ 'repos.txt': '# nothing\n\n' }));
    expect(() => sourcesFromList(join(repo.root, 'repos.txt'))).toThrow(/no repos/i);
  });
});

describe('sourcesFromDir', () => {
  it('lists immediate subdirectories, sorted, ignoring files', () => {
    const repo = track(makeRepo({ 'stray.txt': 'x' }));
    mkdirSync(join(repo.root, 'beta'));
    mkdirSync(join(repo.root, 'alpha'));
    writeFileSync(join(repo.root, 'alpha', 'CLAUDE.md'), '# hi\n');
    expect(sourcesFromDir(repo.root)).toEqual([
      { name: 'alpha', dir: join(repo.root, 'alpha') },
      { name: 'beta', dir: join(repo.root, 'beta') },
    ]);
  });

  it('rejects a directory with no subdirectories', () => {
    const repo = track(makeRepo({ 'stray.txt': 'x' }));
    expect(() => sourcesFromDir(repo.root)).toThrow(/no repos/i);
  });
});
