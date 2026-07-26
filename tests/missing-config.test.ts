import { afterAll, describe, expect, it } from 'vitest';
import { missingConfig } from '../src/rules/missing-config.js';
import { makeRepo, type CommitSpec, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

function activeRepo(extra: Record<string, string> = {}): FixtureRepo {
  const sources: Record<string, string> = { ...extra };
  for (let i = 0; i < 6; i++) sources[`src/mod${i}.ts`] = `export const x${i} = ${i};`;
  const commits: CommitSpec[] = [{ files: sources, daysAgo: 100 }];
  for (let i = 0; i < 21; i++) {
    commits.push({ files: { 'src/main.ts': `// rev ${i}` }, daysAgo: 50 - i });
  }
  return makeRepo({}, { commits });
}

describe('missing-config', () => {
  it('warns for an active code repo with no agent configs', () => {
    const repo = track(activeRepo());
    const findings = missingConfig.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'missing-config', severity: 'warn', file: null });
  });

  it('stays quiet when any agent config exists', () => {
    const repo = track(activeRepo({ 'CLAUDE.md': '# rules' }));
    expect(missingConfig.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('stays quiet for young repos', () => {
    const repo = track(
      makeRepo({}, { commits: [{ files: { 'src/a.ts': 'x', 'src/b.ts': 'y' }, daysAgo: 1 }] }),
    );
    expect(missingConfig.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('stays quiet for repos without source code', () => {
    const commits: CommitSpec[] = [];
    for (let i = 0; i < 25; i++) {
      commits.push({ files: { 'notes.md': `rev ${i}` }, daysAgo: 30 - i });
    }
    const repo = track(makeRepo({}, { commits }));
    expect(missingConfig.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('stays quiet outside git repos', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`src/m${i}.ts`] = 'x';
    const repo = track(makeRepo(files));
    expect(missingConfig.check(makeCtx(repo.root))).toHaveLength(0);
  });
});
