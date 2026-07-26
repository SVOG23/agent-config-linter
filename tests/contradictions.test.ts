import { afterAll, describe, expect, it } from 'vitest';
import { contradictions } from '../src/rules/contradictions.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

function check(files: Record<string, string>) {
  const repo = track(makeRepo(files));
  return contradictions.check(makeCtx(repo.root));
}

describe('contradictions', () => {
  it('flags conflicting package manager assertions across files', () => {
    const findings = check({
      'CLAUDE.md': '# Rules\nAlways use pnpm for installs\n',
      '.cursorrules': 'Use npm to install dependencies\n',
    });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'warn')).toBe(true);
    const byFile = new Map(findings.map((f) => [f.file, f]));
    expect(byFile.get('CLAUDE.md')!.message).toMatch(/\.cursorrules/);
    expect(byFile.get('.cursorrules')!.message).toMatch(/CLAUDE\.md/);
    expect(byFile.get('CLAUDE.md')!.line).toBe(2);
  });

  it('stays quiet when files agree', () => {
    expect(
      check({
        'CLAUDE.md': 'Use pnpm for everything\n',
        'AGENTS.md': 'Use pnpm here too\n',
      }),
    ).toHaveLength(0);
  });

  it('ignores bare command mentions — only assertions count', () => {
    expect(
      check({
        'CLAUDE.md': 'Use pnpm.\n',
        'AGENTS.md': 'Example: npm run test prints results\n',
      }),
    ).toHaveLength(0);
  });

  it('is not fooled by negated assertions', () => {
    expect(
      check({
        'CLAUDE.md': "Don't use yarn. Use pnpm.\n",
        'AGENTS.md': 'Use pnpm\n',
      }),
    ).toHaveLength(0);
  });

  it('flags tabs vs spaces conflicts', () => {
    const findings = check({
      'CLAUDE.md': 'Use tabs for indentation\n',
      '.cursorrules': 'Indent with 2 spaces\n',
    });
    expect(findings).toHaveLength(2);
    expect(findings[0].message).toMatch(/indent/i);
  });

  it('reports duplicated commit conventions as info', () => {
    const findings = check({
      'CLAUDE.md': 'Use conventional commits\n',
      'AGENTS.md': 'Commit messages follow the 50/72 rule\n',
    });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });

  it('does not flag a topic mentioned twice in one file', () => {
    expect(
      check({
        'CLAUDE.md': 'Use conventional commits.\nCommit messages stay short.\n',
      }),
    ).toHaveLength(0);
  });
});
