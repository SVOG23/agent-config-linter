import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck, runScan } from '../src/run.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

const longLines = Array.from({ length: 250 }, (_, i) => `- rule ${i}`).join('\n');

function messyRepo(): FixtureRepo {
  return makeRepo({
    'CLAUDE.md': `${longLines}\nRead @docs/missing.md\nI prefer tabs\n`,
    'AGENTS.md': 'Use npm\n',
    '.cursorrules': 'Use pnpm\n',
  });
}

describe('runScan', () => {
  it('inventories config files', () => {
    const repo = track(messyRepo());
    const result = runScan(repo.root);
    expect(result.files.map((f) => f.path)).toEqual(['.cursorrules', 'AGENTS.md', 'CLAUDE.md']);
  });
});

describe('runCheck git health', () => {
  // Reporting "no issues" when the history read failed is a false all-clear:
  // the rules that depend on git never actually ran. The result has to carry
  // the failure so the reporter can say the check was incomplete.
  it('reports the git failure when history cannot be read', () => {
    const repo = track(
      makeRepo(
        { 'src/a.ts': 'x' },
        { commits: [{ files: { 'CLAUDE.md': '# rules' }, daysAgo: 200 }] },
      ),
    );
    const objects = join(repo.root, '.git', 'objects');
    rmSync(objects, { recursive: true, force: true });
    mkdirSync(objects, { recursive: true });
    const result = runCheck(repo.root);
    expect(result.gitError).not.toBeNull();
    expect(result.gitError).toMatch(/bad object|fatal/i);
  });

  it('reports no git failure for a healthy repo', () => {
    const repo = track(
      makeRepo({}, { commits: [{ files: { 'CLAUDE.md': '# rules' }, daysAgo: 5 }] }),
    );
    expect(runCheck(repo.root).gitError).toBeNull();
  });

  it('reports no git failure outside a git repo', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# rules' }));
    expect(runCheck(repo.root).gitError).toBeNull();
  });
});

describe('runCheck', () => {
  it('aggregates findings from multiple rules, sorted by file then line', () => {
    const repo = track(messyRepo());
    const result = runCheck(repo.root);
    const rules = new Set(result.findings.map((f) => f.rule));
    expect(rules).toContain('oversized');
    expect(rules).toContain('broken-refs');
    expect(rules).toContain('wrong-level');
    expect(rules).toContain('contradictions');

    const claudeFindings = result.findings.filter((f) => f.file === 'CLAUDE.md');
    const lines = claudeFindings.map((f) => f.line ?? 0);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);

    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.summary.warnings).toBeGreaterThan(0);
    expect(
      result.summary.errors + result.summary.warnings + result.summary.infos,
    ).toBe(result.findings.length);
  });

  it('skips disabled rules', () => {
    const repo = track(messyRepo());
    const result = runCheck(repo.root, { rules: ['oversized'] });
    expect(new Set(result.findings.map((f) => f.rule))).toEqual(new Set(['oversized']));
  });

  it('applies severity overrides from config', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Read @docs/missing.md\n',
        '.agentlint.json': JSON.stringify({ rules: { 'broken-refs': { severity: 'warn' } } }),
      }),
    );
    const result = runCheck(repo.root);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('warn');
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(1);
  });

  it('returns cleanly on an empty directory', () => {
    const repo = track(makeRepo({}));
    const result = runCheck(repo.root);
    expect(result.findings).toEqual([]);
    expect(result.files).toEqual([]);
  });
});
