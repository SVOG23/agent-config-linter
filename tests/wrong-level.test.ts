import { afterAll, describe, expect, it } from 'vitest';
import { wrongLevel } from '../src/rules/wrong-level.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

function check(claudeMd: string) {
  const repo = track(makeRepo({ 'CLAUDE.md': claudeMd }));
  return wrongLevel.check(makeCtx(repo.root));
}

describe('wrong-level', () => {
  it('flags machine-specific absolute paths with line numbers', () => {
    const findings = check('# Setup\nData lives in /Users/alice/dev/data\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'wrong-level', severity: 'warn', line: 2 });
    expect(findings[0].message).toMatch(/\/Users\/alice/);
  });

  it('flags linux and windows home paths', () => {
    expect(check('cd /home/bob/projects/x\n')).toHaveLength(1);
    expect(check('Open C:\\Users\\bob\\dev\\proj\n')).toHaveLength(1);
  });

  it('ignores personal-preference phrasing inside fenced blocks (decision trees, examples)', () => {
    const findings = check(
      'Pick a mode:\n```\n├─ I want full control\n├─ I want built-in tools\n```\nUse tabs.\n',
    );
    expect(findings).toHaveLength(0);
  });

  it('still flags personal content in inline code spans', () => {
    const findings = check('The backend dep lives at `/home/danny/agentus` for reference\n');
    expect(findings).toHaveLength(1);
  });

  it('ignores CI-runner and generic example home paths', () => {
    expect(check('cd /home/runner/work/repo/repo/python\n')).toHaveLength(0);
    expect(check('Assume checkout at /home/user/project/ layout\n')).toHaveLength(0);
  });

  it('flags first-person preferences', () => {
    const findings = check('I prefer tabs over spaces\n');
    expect(findings).toHaveLength(1);
    expect(findings[0].suggestion).toMatch(/~\/.claude\/CLAUDE\.md/);
  });

  it('flags references to a personal machine', () => {
    expect(check('This only works on my machine right now\n')).toHaveLength(1);
  });

  it('stays quiet on clean project instructions', () => {
    const findings = check(
      '# Project\nRun `npm test`.\nUsers can configure settings in the app.\nUse tabs.\n',
    );
    expect(findings).toHaveLength(0);
  });

  it('skips user-local files like CLAUDE.local.md', () => {
    const repo = track(makeRepo({ 'CLAUDE.local.md': 'I prefer verbose logs\n' }));
    expect(wrongLevel.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('reports each offending line once', () => {
    const findings = check('I prefer x\nfine line\nI like y from /Users/me/stuff\n');
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.line)).toEqual([1, 3]);
  });
});
