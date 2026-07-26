import { afterAll, describe, expect, it } from 'vitest';
import { eagerEmbeds } from '../src/rules/eager-embeds.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

const bigDoc = `# Guide\n${'lorem ipsum dolor sit amet\n'.repeat(600)}`; // ~16KB

describe('eager-embeds', () => {
  it('warns when an @-import embeds a large file', () => {
    const repo = track(
      makeRepo({ 'CLAUDE.md': 'Read @docs/guide.md before anything\n', 'docs/guide.md': bigDoc }),
    );
    const findings = eagerEmbeds.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'eager-embeds',
      severity: 'warn',
      file: 'CLAUDE.md',
      line: 1,
    });
    expect(findings[0].message).toMatch(/docs\/guide\.md/);
    expect(findings[0].suggestion).toMatch(/conditional/i);
  });

  it('stays quiet for small embeds', () => {
    const repo = track(
      makeRepo({ 'CLAUDE.md': 'Read @docs/small.md\n', 'docs/small.md': '# tiny\n' }),
    );
    expect(eagerEmbeds.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('leaves missing targets to broken-refs', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/gone.md\n' }));
    expect(eagerEmbeds.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('resolves imports relative to the config file', () => {
    const repo = track(
      makeRepo({
        'packages/api/CLAUDE.md': 'Read @docs/guide.md\n',
        'packages/api/docs/guide.md': bigDoc,
      }),
    );
    expect(eagerEmbeds.check(makeCtx(repo.root))).toHaveLength(1);
  });

  it('honors the configured byte threshold', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Read @docs/guide.md\n',
        'docs/guide.md': '# medium\n' + 'x'.repeat(3000) + '\n',
        '.agentlint.json': JSON.stringify({ rules: { 'eager-embeds': { maxEmbedBytes: 1000 } } }),
      }),
    );
    expect(eagerEmbeds.check(makeCtx(repo.root))).toHaveLength(1);
  });
});
