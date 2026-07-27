import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { staleness } from '../src/rules/staleness.js';
import { makeRepo, type CommitSpec, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

function repoWithConfigAndActivity(
  configDaysAgo: number,
  laterCommits: number,
  laterDaysAgo = 30,
): FixtureRepo {
  const commits: CommitSpec[] = [{ files: { 'CLAUDE.md': '# rules' }, daysAgo: configDaysAgo }];
  for (let i = 0; i < laterCommits; i++) {
    commits.push({ files: { [`src/f${i}.ts`]: `// ${i}` }, daysAgo: laterDaysAgo });
  }
  return makeRepo({}, { commits });
}

function setThresholds(repo: FixtureRepo, settings: object): void {
  writeFileSync(
    join(repo.root, '.agentlint.json'),
    JSON.stringify({ rules: { staleness: settings } }),
  );
}

describe('staleness', () => {
  // 121 git commits in the fixture; Windows spawns git ~10x slower than POSIX.
  it('warns when the config is old and the repo moved on without it (default thresholds)', { timeout: 60_000 }, () => {
    const repo = track(repoWithConfigAndActivity(200, 120));
    const findings = staleness.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'staleness', severity: 'warn', file: 'CLAUDE.md' });
    expect(findings[0].message).toMatch(/200 days/);
    expect(findings[0].message).toMatch(/120 commits/);
  });

  it('stays quiet when the repo is mostly dormant', () => {
    const repo = track(repoWithConfigAndActivity(200, 5));
    expect(staleness.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('stays quiet when the config is fresh, even in a busy repo', () => {
    const repo = track(repoWithConfigAndActivity(5, 8, 3));
    setThresholds(repo, { minCommitsSince: 3 });
    expect(staleness.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('does nothing outside git repos', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# rules' }));
    expect(staleness.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('honors configured thresholds', () => {
    const repo = track(repoWithConfigAndActivity(200, 5));
    setThresholds(repo, { minCommitsSince: 3 });
    const findings = staleness.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
  });
});
