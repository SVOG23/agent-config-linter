import { afterAll, describe, expect, it } from 'vitest';
import { openGit } from '../src/git.js';
import { DAY_MS, makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('openGit', () => {
  it('returns null outside a git repo', () => {
    const repo = track(makeRepo({ 'a.txt': 'hi' }));
    expect(openGit(repo.root)).toBeNull();
  });

  it('reports per-file last commit times', () => {
    const repo = track(
      makeRepo(
        { 'untracked.md': 'new' },
        {
          commits: [
            { files: { 'old.md': 'v1' }, daysAgo: 200 },
            { files: { 'new.md': 'v1' }, daysAgo: 10 },
          ],
        },
      ),
    );
    const git = openGit(repo.root);
    expect(git).not.toBeNull();
    const oldMs = git!.lastCommitMs('old.md')!;
    const newMs = git!.lastCommitMs('new.md')!;
    expect(Math.abs(oldMs - (Date.now() - 200 * DAY_MS))).toBeLessThan(60_000);
    expect(Math.abs(newMs - (Date.now() - 10 * DAY_MS))).toBeLessThan(60_000);
    expect(git!.lastCommitMs('untracked.md')).toBeNull();
    expect(git!.lastCommitMs('nope.md')).toBeNull();
  });

  it('counts commits since a timestamp and in total', () => {
    const repo = track(
      makeRepo(
        {},
        {
          commits: [
            { files: { 'a.md': 'v1' }, daysAgo: 200 },
            { files: { 'b.md': 'v1' }, daysAgo: 50 },
            { files: { 'c.md': 'v1' }, daysAgo: 10 },
          ],
        },
      ),
    );
    const git = openGit(repo.root)!;
    expect(git.totalCommits()).toBe(3);
    expect(git.commitsSince(Date.now() - 100 * DAY_MS)).toBe(2);
    expect(git.commitsSince(Date.now() - 300 * DAY_MS)).toBe(3);
    expect(git.commitsSince(Date.now())).toBe(0);
  });

  it('handles a repo with no commits', () => {
    const repo = track(makeRepo({ 'a.txt': 'hi' }, { git: true }));
    const git = openGit(repo.root)!;
    expect(git.totalCommits()).toBe(0);
    expect(git.lastCommitMs('a.txt')).toBeNull();
    expect(git.commitsSince(0)).toBe(0);
  });
});
