import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../run.js';
import type { FleetRepoOutcome, FleetResult, FleetTotals } from '../types.js';
import { cloneRepo } from './clone.js';
import { listGithubRepos } from './github.js';
import { healthGrade } from './health.js';
import { parseTarget, sourcesFromDir, sourcesFromList, type RepoSource } from './targets.js';

export interface FleetOptions {
  configPath?: string;
  /** Parallel repo scans. Default 4. */
  concurrency?: number;
  /** Keep temp clones instead of deleting them. */
  keep?: boolean;
  token?: string;
  includeArchived?: boolean;
  includeForks?: boolean;
  fetchImpl?: typeof fetch;
  onRepoDone?(outcome: FleetRepoOutcome, done: number, total: number): void;
}

export interface FleetRunResult extends FleetResult {
  /** Set when clones were kept via `keep`. */
  tempDir?: string;
}

async function resolveSources(rawTarget: string, cwd: string, opts: FleetOptions): Promise<RepoSource[]> {
  const target = parseTarget(rawTarget, cwd);
  if (target.kind === 'github') {
    return listGithubRepos(target.owner, {
      token: opts.token ?? process.env['GITHUB_TOKEN'],
      includeArchived: opts.includeArchived,
      includeForks: opts.includeForks,
      fetchImpl: opts.fetchImpl,
    });
  }
  return target.kind === 'list' ? sourcesFromList(target.path) : sourcesFromDir(target.path);
}

async function scanSource(source: RepoSource, tempDir: string | null, opts: FleetOptions): Promise<FleetRepoOutcome> {
  let root = source.dir;
  if (!root) {
    // tempDir exists whenever any source is remote.
    root = join(tempDir!, source.name.replace(/[^\w.-]+/g, '__'));
    await cloneRepo(source.url!, root);
  }
  const result = runCheck(root, { configPath: opts.configPath });
  return {
    repo: source.name,
    health: healthGrade(result.summary, result.files.length),
    summary: result.summary,
    findings: result.findings,
    configCount: result.files.length,
  };
}

function computeTotals(outcomes: FleetRepoOutcome[]): FleetTotals {
  const totals: FleetTotals = { repos: outcomes.length, withConfigs: 0, withFindings: 0, errors: 0, warnings: 0 };
  for (const outcome of outcomes) {
    if ((outcome.configCount ?? 0) > 0) totals.withConfigs++;
    if ((outcome.findings?.length ?? 0) > 0) totals.withFindings++;
    totals.errors += outcome.summary?.errors ?? 0;
    totals.warnings += outcome.summary?.warnings ?? 0;
  }
  return totals;
}

export async function runFleet(
  rawTarget: string,
  cwd: string,
  opts: FleetOptions = {},
): Promise<FleetRunResult> {
  const sources = await resolveSources(rawTarget, cwd, opts);
  const needsClone = sources.some((source) => !source.dir);
  const tempDir = needsClone ? mkdtempSync(join(tmpdir(), 'unrot-fleet-')) : null;

  const outcomes: FleetRepoOutcome[] = new Array(sources.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < sources.length; i = next++) {
      const source = sources[i]!;
      let outcome: FleetRepoOutcome;
      try {
        outcome = await scanSource(source, tempDir, opts);
      } catch (error) {
        outcome = { repo: source.name, error: (error as Error).message };
      }
      outcomes[i] = outcome;
      opts.onRepoDone?.(outcome, ++done, sources.length);
    }
  };

  try {
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, sources.length));
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    if (tempDir && !opts.keep) rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    target: rawTarget,
    repos: outcomes,
    totals: computeTotals(outcomes),
    ...(tempDir && opts.keep ? { tempDir } : {}),
  };
}
