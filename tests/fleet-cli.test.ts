import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

function makeFleetDir(): FixtureRepo {
  const fleet = track(makeRepo({}));
  const write = (rel: string, content: string) => {
    const abs = join(fleet.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  write('clean/CLAUDE.md', '# Fine\n');
  write('warny/CLAUDE.md', 'I prefer tabs\n');
  return fleet;
}

describe('unrot fleet CLI', () => {
  it('prints the fleet table for a local directory and exits 0 without errors', async () => {
    const fleet = makeFleetDir();
    const result = await cli(['fleet', fleet.root], '/');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Repo\s+Configs\s+Errors\s+Warnings\s+Health/);
    expect(result.stdout).toContain('clean');
    expect(result.stdout).toContain('warny');
  });

  it('exits 1 when any repo has errors', async () => {
    const fleet = track(makeRepo({}));
    mkdirSync(join(fleet.root, 'errory'));
    writeFileSync(join(fleet.root, 'errory', 'CLAUDE.md'), 'Read @docs/missing.md\n');
    const result = await cli(['fleet', fleet.root], '/');
    expect(result.code).toBe(1);
  });

  it('streams per-repo progress to stderr', async () => {
    const fleet = makeFleetDir();
    const result = await cli(['fleet', fleet.root], '/');
    expect(result.stderr).toMatch(/\[1\/2\]/);
    expect(result.stderr).toMatch(/\[2\/2\]/);
  });

  it('emits parseable schemaVersion-2 JSON with --json', async () => {
    const fleet = makeFleetDir();
    const result = await cli(['fleet', fleet.root, '--json'], '/');
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.fleet).toBe(true);
    expect(parsed.repos).toHaveLength(2);
    expect(parsed.totals.repos).toBe(2);
  });

  it('exits 2 with usage when the target is missing', async () => {
    const result = await cli(['fleet'], '/');
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
  });

  it('exits 2 on an unresolvable target', async () => {
    const result = await cli(['fleet', 'no/such/target'], '/');
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/no such/i);
  });

  it('rejects a bad --concurrency value', async () => {
    const fleet = makeFleetDir();
    const bad = await cli(['fleet', fleet.root, '--concurrency', 'zero'], '/');
    expect(bad.code).toBe(2);
    const negative = await cli(['fleet', fleet.root, '--concurrency', '0'], '/');
    expect(negative.code).toBe(2);
  });

  it('rejects fleet-only flags on other commands', async () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# Fine\n' }));
    const result = await cli(['check', '--keep'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/fleet/i);
  });

  it('resolves a relative --config against the invocation cwd, not each repo', async () => {
    const holder = track(makeRepo({ 'fleet-config.json': '{"rules": {"broken-refs": {"severity": "warn"}}}' }));
    mkdirSync(join(holder.root, 'repos', 'errory'), { recursive: true });
    writeFileSync(join(holder.root, 'repos', 'errory', 'CLAUDE.md'), 'Read @docs/missing.md\n');
    const result = await cli(['fleet', 'repos', '--config', 'fleet-config.json', '--json'], holder.root);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.repos[0].error).toBeUndefined();
    expect(parsed.totals.errors).toBe(0);
    expect(parsed.totals.warnings).toBe(1);
  });

  it('mentions fleet in help output', async () => {
    const result = await cli(['--help'], '/');
    expect(result.stdout).toContain('fleet');
    expect(result.stdout).toContain('gh:');
  });
});
