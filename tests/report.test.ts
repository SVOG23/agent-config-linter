import { afterAll, describe, expect, it } from 'vitest';
import { colorize } from '../src/colors.js';
import { renderCheckJson, renderScanJson } from '../src/report/json.js';
import { renderCheckText, renderScanText } from '../src/report/terminal.js';
import { runCheck, runScan } from '../src/run.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

const plain = colorize(false);

describe('terminal output', () => {
  it('groups check findings by file with a summary line', () => {
    const repo = track(
      makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md\nI prefer tabs\n' }),
    );
    const text = renderCheckText(runCheck(repo.root), plain);
    expect(text).toContain('CLAUDE.md');
    expect(text).toMatch(/✖.*docs\/missing\.md/);
    expect(text).toMatch(/⚠.*Personal preference/);
    expect(text).toMatch(/1 error, 1 warning/);
  });

  it('prints repo-level findings under a repository heading', () => {
    const commits = Array.from({ length: 21 }, (_, i) => ({
      files: { [`src/f${i % 6}.ts`]: `// rev ${i}` },
      daysAgo: 30 - i,
    }));
    const repo = track(makeRepo({}, { commits }));
    const text = renderCheckText(runCheck(repo.root), plain);
    expect(text).toContain('(repository)');
    expect(text).toMatch(/no agent config files/i);
  });

  it('reports a clean bill of health', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# Short and correct\n' }));
    const text = renderCheckText(runCheck(repo.root), plain);
    expect(text).toMatch(/no issues found/i);
  });

  it('lists scanned files with size and date', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# hi\n' }));
    const text = renderScanText(runScan(repo.root), plain);
    expect(text).toContain('CLAUDE.md');
    expect(text).toMatch(/claude-md/);
    expect(text).toMatch(/\d+ B|\d+\.\d KB/);
  });
});

describe('json output', () => {
  it('emits a stable check schema', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md\n' }));
    const parsed = JSON.parse(renderCheckJson(runCheck(repo.root)));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.files[0]).toMatchObject({ path: 'CLAUDE.md', kind: 'claude-md' });
    expect(typeof parsed.files[0].modified).toBe('string');
    expect(parsed.findings[0]).toMatchObject({
      rule: 'broken-refs',
      severity: 'error',
      file: 'CLAUDE.md',
      line: 1,
    });
    expect(parsed.summary).toEqual({ errors: 1, warnings: 0, infos: 0 });
  });

  it('emits a scan schema', () => {
    const repo = track(makeRepo({ '.mcp.json': '{}' }));
    const parsed = JSON.parse(renderScanJson(runScan(repo.root)));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].kind).toBe('mcp-config');
  });
});
