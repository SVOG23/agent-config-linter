import { afterAll, describe, expect, it } from 'vitest';
import { brokenRefs } from '../src/rules/broken-refs.js';
import { extractRefs } from '../src/rules/refs.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('extractRefs', () => {
  it('extracts @-imports with line numbers', () => {
    const refs = extractRefs('# Title\n\nSee @docs/guide.md for details\n@README.md\n');
    expect(refs).toContainEqual({ kind: 'at-import', value: 'docs/guide.md', line: 3 });
    expect(refs).toContainEqual({ kind: 'at-import', value: 'README.md', line: 4 });
  });

  it('ignores emails, handles, and npm scopes', () => {
    const refs = extractRefs(
      'Contact dev@example.com or @octocat\nUse @types/node and @scope/pkg\n',
    );
    expect(refs.filter((r) => r.kind === 'at-import')).toHaveLength(0);
  });

  it('extracts relative markdown links but not urls or anchors', () => {
    const refs = extractRefs(
      '[guide](docs/guide.md) [site](https://x.com) [top](#top) [mail](mailto:a@b.c)\n[sub](./sub/file.md#section)\n',
    );
    const links = refs.filter((r) => r.kind === 'md-link').map((r) => r.value);
    expect(links).toEqual(['docs/guide.md', './sub/file.md']);
  });

  it('extracts path-like backtick tokens, skipping globs and placeholders', () => {
    const refs = extractRefs(
      'Run `scripts/deploy.sh` then `src/**/*.ts` and `<path/to/file.md>` and `x.py`\nAlso `docs/setup.md`.\n',
    );
    const tokens = refs.filter((r) => r.kind === 'path-token').map((r) => r.value);
    expect(tokens).toEqual(['scripts/deploy.sh', 'docs/setup.md']);
  });

  it('extracts npm run scripts', () => {
    const refs = extractRefs('Run `npm run build:prod` and pnpm run lint before pushing\n');
    const scripts = refs.filter((r) => r.kind === 'npm-script').map((r) => r.value);
    expect(scripts).toEqual(['build:prod', 'lint']);
  });
});

describe('broken-refs', () => {
  it('errors on @-imports pointing nowhere', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md first\n' }));
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'broken-refs',
      severity: 'error',
      file: 'CLAUDE.md',
      line: 1,
    });
    expect(findings[0].message).toContain('docs/missing.md');
  });

  it('accepts refs that exist (root- or file-relative)', () => {
    const repo = track(
      makeRepo({
        'packages/api/CLAUDE.md': 'See @docs/api.md and [root doc](README.md)\n',
        'packages/api/docs/api.md': '# api',
        'README.md': '# root',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('errors on broken markdown links and backtick paths', () => {
    const repo = track(
      makeRepo({ 'AGENTS.md': '[setup](docs/setup.md)\nRun `scripts/gone.sh`\n' }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.line)).toEqual([1, 2]);
  });

  it('checks npm scripts against root package.json', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Run `npm run test` and `npm run nope`\n',
        'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('nope');
  });

  it('skips npm script checks when there is no package.json', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Run `npm run anything`\n' }));
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('does not flag files that exist on disk but are gitignored', () => {
    const repo = track(
      makeRepo(
        { 'local/notes.md': 'secret' },
        { commits: [{ files: { '.gitignore': 'local/\n', 'CLAUDE.md': 'See @local/notes.md\n' }, daysAgo: 1 }] },
      ),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });
});
