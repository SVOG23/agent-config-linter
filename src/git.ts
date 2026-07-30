import { execFileSync } from 'node:child_process';
import type { GitInfo } from './types.js';

/**
 * Success and failure are kept distinct: collapsing both to null made an
 * unreadable repo indistinguishable from one with nothing to report, so a git
 * failure surfaced as a clean run rather than as a problem.
 */
type RunResult = { ok: true; out: string } | { ok: false; err: string };

function run(root: string, args: string[]): RunResult {
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (cause) {
    const { stderr, message } = cause as { stderr?: string | Buffer; message?: string };
    const detail = (stderr?.toString() || message || '').trim();
    return { ok: false, err: detail || `git ${args[0]} failed` };
  }
}

/**
 * Why git could not be used at `root`, or null when this simply is not a repo.
 * Both cases exit 128, so a repo git refuses to open — dubious ownership, a
 * broken gitdir pointer — otherwise looked the same as a plain directory and
 * skipped every history-based rule without saying so. Only the genuine
 * no-repository-anywhere case mentions the parent directories it searched.
 */
export function gitUnavailableReason(root: string): string | null {
  const inside = run(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.ok) return null;
  if (/not a git repository \(or any/i.test(inside.err)) return null;
  return inside.err;
}

/** Returns git metadata helpers for `root`, or null when not inside a git work tree. */
export function openGit(root: string): GitInfo | null {
  const inside = run(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out.trim() !== 'true') return null;

  const lastCommitCache = new Map<string, number | null>();
  let commitTimes: number[] | null = null;
  let readError: string | null = null;
  let headResolves: boolean | null = null;

  /**
   * Whether HEAD names a commit. False on a branch with no commits yet, where a
   * failing history read is the honest answer rather than a fault. True once a
   * commit exists, which makes any later read failure a real problem.
   */
  const hasHead = (): boolean => {
    headResolves ??= run(root, ['rev-parse', '--quiet', '--verify', 'HEAD']).ok;
    return headResolves;
  };

  // One pass over the whole history; counting in JS avoids the traversal
  // quirks of `rev-list --since` (observed undercounting in CI).
  const allCommitTimes = (): number[] => {
    if (commitTimes === null) {
      commitTimes = [];
      if (!hasHead()) return commitTimes;
      const log = run(root, ['log', '--format=%ct']);
      if (!log.ok) {
        readError = log.err;
        return commitTimes;
      }
      commitTimes = log.out
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => Number(line) * 1000);
    }
    return commitTimes;
  };

  return {
    get error(): string | null {
      return readError;
    },

    lastCommitMs(relPath: string): number | null {
      if (lastCommitCache.has(relPath)) return lastCommitCache.get(relPath)!;
      const out = run(root, ['log', '-1', '--format=%ct', '--', relPath]);
      // A path with no commits still exits 0 with empty output, so a non-zero
      // exit here is a real failure. Left unrecorded it looks like "never
      // committed", and callers fall back to mtime and see a fresh file.
      if (!out.ok && hasHead()) readError ??= out.err;
      const seconds = out.ok ? out.out.trim() : '';
      const value = seconds ? Number(seconds) * 1000 : null;
      lastCommitCache.set(relPath, value);
      return value;
    },

    commitsSince(unixMs: number): number {
      return allCommitTimes().filter((t) => t > unixMs).length;
    },

    totalCommits(): number {
      return allCommitTimes().length;
    },
  };
}

/** All files git knows about at `root`: tracked plus untracked-but-not-ignored. */
export function gitListFiles(root: string): string[] | null {
  const out = run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (!out.ok) return null;
  return out.out.split('\0').filter((p) => p.length > 0);
}
