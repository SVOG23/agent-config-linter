import { afterAll, describe, expect, it } from 'vitest';
import { oversized } from '../src/rules/oversized.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

const lines = (n: number) => Array.from({ length: n }, (_, i) => `- rule ${i}`).join('\n');

describe('oversized', () => {
  it('errors past the error line threshold', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': lines(250) }));
    const findings = oversized.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'oversized', severity: 'error', file: 'CLAUDE.md' });
    expect(findings[0].message).toMatch(/250 lines/);
  });

  it('warns past the warn line threshold', () => {
    const repo = track(makeRepo({ 'AGENTS.md': lines(150) }));
    const findings = oversized.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });

  it('stays quiet for small files', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': lines(50) }));
    expect(oversized.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('warns on byte size even with few lines', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': `# big\n${'x'.repeat(11 * 1024)}` }));
    const findings = oversized.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toMatch(/KB/);
  });

  it('ignores non-instruction files', () => {
    const repo = track(makeRepo({ '.mcp.json': `{\n${'"k": 1,\n'.repeat(300)}"z": 1}` }));
    expect(oversized.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('honors configured thresholds', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': lines(60),
        '.agentlint.json': JSON.stringify({ rules: { oversized: { warnLines: 50 } } }),
      }),
    );
    const findings = oversized.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });
});
