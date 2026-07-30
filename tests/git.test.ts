import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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

  // An unborn branch and an unreadable history both make `git log` exit 128.
  // Treating them alike turns a broken repo into "nothing to report", which is
  // how a CI git failure surfaced as a clean staleness run. HEAD tells them
  // apart: it does not resolve on a fresh repo, and does resolve when the
  // commit exists but its objects cannot be read.
  it('reports no error for a repo that simply has no commits yet', () => {
    const repo = track(makeRepo({ 'a.txt': 'hi' }, { git: true }));
    const git = openGit(repo.root)!;
    git.totalCommits(); // force the history read
    expect(git.error).toBeNull();
  });

  it('surfaces an error when history exists but cannot be read', () => {
    const repo = track(makeRepo({}, { commits: [{ files: { 'a.md': 'v1' }, daysAgo: 10 }] }));
    // Empty the object store but keep it in place: the work tree stays valid and
    // HEAD still resolves, yet no commit can be read. Removing the directory
    // outright would make git reject the repo entirely, which is a different case.
    const objects = join(repo.root, '.git', 'objects');
    rmSync(objects, { recursive: true, force: true });
    mkdirSync(objects, { recursive: true });
    const git = openGit(repo.root);
    expect(git).not.toBeNull();
    git!.totalCommits();
    expect(git!.error).not.toBeNull();
    expect(git!.error).toMatch(/bad object|fatal/i);
  });
});

describe('makeRepo fixture', () => {
  // The fixture is the foundation every git-dependent test stands on. When its
  // commits silently fail to land, assertions expecting findings fail while
  // every assertion expecting none passes — the failure reads as a quiet repo.
  it('creates exactly the commits it was asked for', () => {
    const repo = track(
      makeRepo(
        {},
        {
          commits: [
            { files: { 'a.md': '1' }, daysAgo: 30 },
            { files: { 'b.md': '1' }, daysAgo: 20 },
            { files: { 'c.md': '1' }, daysAgo: 10 },
          ],
        },
      ),
    );
    const git = openGit(repo.root)!;
    expect(git.error).toBeNull();
    expect(git.totalCommits()).toBe(3);
  });
});
