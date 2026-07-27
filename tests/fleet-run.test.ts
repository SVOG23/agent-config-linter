import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runFleet } from '../src/fleet/run.js';
import type { FleetRepoOutcome } from '../src/types.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

/** A directory of four fake repos covering each health grade. */
function makeFleetDir(): FixtureRepo {
  const fleet = track(makeRepo({}));
  const write = (rel: string, content: string) => {
    const abs = join(fleet.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  write('clean/CLAUDE.md', '# Fine\n');
  write('warny/CLAUDE.md', 'I prefer tabs\n');
  write('errory/CLAUDE.md', 'Read @docs/missing.md\nSee @docs/gone.md\nAlso @docs/nope.md\n');
  write('bare/README.md', 'no agent configs here\n');
  return fleet;
}

function outcome(outcomes: FleetRepoOutcome[], repo: string): FleetRepoOutcome {
  const found = outcomes.find((o) => o.repo === repo);
  if (!found) throw new Error(`missing outcome for ${repo}`);
  return found;
}

describe('runFleet', () => {
  it('scans a local directory of repos and grades each', async () => {
    const fleet = makeFleetDir();
    const result = await runFleet(fleet.root, '/', {});
    expect(result.repos.map((r) => r.repo)).toEqual(['bare', 'clean', 'errory', 'warny']);
    expect(outcome(result.repos, 'clean').health).toBe('A');
    expect(outcome(result.repos, 'warny').health).toBe('B');
    expect(outcome(result.repos, 'errory').health).toBe('D');
    expect(outcome(result.repos, 'bare').health).toBeNull();
    expect(outcome(result.repos, 'bare').configCount).toBe(0);
    expect(result.totals).toEqual({
      repos: 4,
      withConfigs: 3,
      withFindings: 2,
      errors: 3,
      warnings: 1,
    });
  });

  it('clones list targets and isolates per-repo failures', async () => {
    const source = track(
      makeRepo({}, { commits: [{ files: { 'CLAUDE.md': '# Fine\n' }, daysAgo: 1 }] }),
    );
    const holder = track(
      makeRepo({
        'repos.txt': [pathToFileURL(source.root).href, pathToFileURL('/no/such/repo-xyz').href].join(
          '\n',
        ),
      }),
    );
    const result = await runFleet(join(holder.root, 'repos.txt'), '/', {});
    expect(result.repos).toHaveLength(2);
    const ok = result.repos[0]!;
    const failed = result.repos[1]!;
    expect(ok.health).toBe('A');
    expect(failed.error).toMatch(/clone failed/i);
    expect(failed.health).toBeUndefined();
    expect(result.totals.repos).toBe(2);
    expect(result.totals.withConfigs).toBe(1);
  });

  it('streams outcomes through onRepoDone with running counts', async () => {
    const fleet = makeFleetDir();
    const seen: [string, number, number][] = [];
    await runFleet(fleet.root, '/', {
      onRepoDone: (o, done, total) => seen.push([o.repo, done, total]),
    });
    expect(seen).toHaveLength(4);
    expect(seen.map(([, done]) => done).sort()).toEqual([1, 2, 3, 4]);
    expect(seen.every(([, , total]) => total === 4)).toBe(true);
  });

  it('removes temp clones by default and keeps them with keep', async () => {
    const source = track(
      makeRepo({}, { commits: [{ files: { 'CLAUDE.md': '# Fine\n' }, daysAgo: 1 }] }),
    );
    const holder = track(makeRepo({ 'repos.txt': pathToFileURL(source.root).href }));
    const listPath = join(holder.root, 'repos.txt');

    const removed = await runFleet(listPath, '/', {});
    expect(removed.tempDir).toBeUndefined();
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('unrot-fleet-'));

    const kept = await runFleet(listPath, '/', { keep: true });
    expect(kept.tempDir).toBeDefined();
    expect(existsSync(kept.tempDir!)).toBe(true);
    const after = readdirSync(tmpdir()).filter((d) => d.startsWith('unrot-fleet-'));
    expect(after.length).toBe(before.length + 1);
  });

  it('does not create a temp dir for local directory targets', async () => {
    const fleet = makeFleetDir();
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('unrot-fleet-'));
    await runFleet(fleet.root, '/', { keep: true });
    const after = readdirSync(tmpdir()).filter((d) => d.startsWith('unrot-fleet-'));
    expect(after.length).toBe(before.length);
  });

  it('respects a concurrency of 1 and still completes everything', async () => {
    const fleet = makeFleetDir();
    const result = await runFleet(fleet.root, '/', { concurrency: 1 });
    expect(result.repos).toHaveLength(4);
  });
});
