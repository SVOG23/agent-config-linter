import { execFileSync } from 'node:child_process';
import type { GitInfo } from './types.js';

function run(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Returns git metadata helpers for `root`, or null when not inside a git work tree. */
export function openGit(root: string): GitInfo | null {
  const inside = run(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside?.trim() !== 'true') return null;

  const lastCommitCache = new Map<string, number | null>();
  let commitTimes: number[] | null = null;

  // One pass over the whole history; counting in JS avoids the traversal
  // quirks of `rev-list --since` (observed undercounting in CI).
  const allCommitTimes = (): number[] => {
    if (commitTimes === null) {
      const out = run(root, ['log', '--format=%ct']);
      commitTimes = out
        ? out
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => Number(line) * 1000)
        : [];
    }
    return commitTimes;
  };

  return {
    lastCommitMs(relPath: string): number | null {
      if (lastCommitCache.has(relPath)) return lastCommitCache.get(relPath)!;
      const out = run(root, ['log', '-1', '--format=%ct', '--', relPath]);
      const seconds = out?.trim();
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
  if (out === null) return null;
  return out.split('\0').filter((p) => p.length > 0);
}
