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
  const sinceCache = new Map<number, number>();
  let total: number | null = null;

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
      const cached = sinceCache.get(unixMs);
      if (cached !== undefined) return cached;
      const iso = new Date(unixMs).toISOString();
      const out = run(root, ['rev-list', '--count', 'HEAD', `--since=${iso}`]);
      const value = out ? Number(out.trim()) || 0 : 0;
      sinceCache.set(unixMs, value);
      return value;
    },

    totalCommits(): number {
      if (total !== null) return total;
      const out = run(root, ['rev-list', '--count', 'HEAD']);
      total = out ? Number(out.trim()) || 0 : 0;
      return total;
    },
  };
}

/** All files git knows about at `root`: tracked plus untracked-but-not-ignored. */
export function gitListFiles(root: string): string[] | null {
  const out = run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (out === null) return null;
  return out.split('\0').filter((p) => p.length > 0);
}
