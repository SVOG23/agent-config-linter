import { afterAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(argv: string[], cwd: string): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(
    argv,
    cwd,
    { write: (s: string) => void (stdout += s) },
    { write: (s: string) => void (stderr += s) },
  );
  return { code, stdout, stderr };
}

describe('runCli', () => {
  it('scan lists config files and exits 0', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# hi\n', '.mcp.json': '{}' }));
    const result = await cli(['scan'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('CLAUDE.md');
    expect(result.stdout).toContain('.mcp.json');
  });

  it('check exits 1 when errors are found', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md\n' }));
    const result = await cli(['check'], repo.root);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('docs/missing.md');
  });

  it('check exits 0 when only warnings are found', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'I prefer tabs\n' }));
    const result = await cli(['check'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Personal preference');
  });

  it('check exits 0 on a clean repo', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# Fine\n' }));
    const result = await cli(['check'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/no issues/i);
  });

  it('exits 2 with a clear message when the path does not exist', async () => {
    const repo = track(makeRepo({}));
    const result = await cli(['check', 'no/such/dir'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/no such directory/i);
    expect(result.stdout).toBe('');
  });

  it('exits 2 when the path is a file, not a directory', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# hi\n' }));
    const result = await cli(['check', 'CLAUDE.md'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/not a directory/i);
  });

  it('tolerates binary content in config files', async () => {
    const bytes = Array.from({ length: 512 }, (_, i) => String.fromCharCode(i % 256)).join('');
    const repo = track(makeRepo({ '.cursorrules': bytes }));
    const result = await cli(['check'], repo.root);
    expect(result.code).toBe(0);
  });

  it('accepts an explicit path argument', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# Fine\n' }));
    const result = await cli(['check', repo.root], '/');
    expect(result.code).toBe(0);
  });

  it('emits parseable JSON with --json', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md\n' }));
    const result = await cli(['check', '--json'], repo.root);
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary.errors).toBe(1);
  });

  it('narrows rules with --rules', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md\nI prefer tabs\n' }));
    const result = await cli(['check', '--rules', 'wrong-level', '--json'], repo.root);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.findings.every((f: { rule: string }) => f.rule === 'wrong-level')).toBe(true);
  });

  it('exits 2 with usage on unknown commands and flags', async () => {
    const repo = track(makeRepo({}));
    const bad = await cli(['frobnicate'], repo.root);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/usage/i);
    const badFlag = await cli(['check', '--wat'], repo.root);
    expect(badFlag.code).toBe(2);
  });

  it('exits 2 on a bad config file', async () => {
    const repo = track(makeRepo({ '.agentlint.json': '{nope' }));
    const result = await cli(['check'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('.agentlint.json');
  });

  it('prints help and version', async () => {
    const repo = track(makeRepo({}));
    const help = await cli(['--help'], repo.root);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/unrot (check|scan)/);
    const version = await cli(['--version'], repo.root);
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
