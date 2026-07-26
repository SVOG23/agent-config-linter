import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CommitSpec {
  files: Record<string, string>;
  daysAgo: number;
  message?: string;
}

export interface RepoOpts {
  git?: boolean;
  commits?: CommitSpec[];
}

export interface FixtureRepo {
  root: string;
  cleanup(): void;
}

function git(root: string, env: NodeJS.ProcessEnv | null, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Builds a throwaway directory of files, optionally a git repo with
 * backdated commits (via GIT_AUTHOR_DATE/GIT_COMMITTER_DATE).
 * Files passed at the top level are written but never committed.
 */
export function makeRepo(files: Record<string, string> = {}, opts: RepoOpts = {}): FixtureRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentlint-fixture-')));
  const writeAll = (fileMap: Record<string, string>) => {
    for (const [rel, content] of Object.entries(fileMap)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  };

  if (opts.git || opts.commits) {
    git(root, null, 'init', '-q', '-b', 'main');
    git(root, null, 'config', 'user.email', 'fixture@example.com');
    git(root, null, 'config', 'user.name', 'Fixture');
    git(root, null, 'config', 'commit.gpgsign', 'false');
    for (const commit of opts.commits ?? []) {
      writeAll(commit.files);
      git(root, null, 'add', '-A');
      const date = new Date(Date.now() - commit.daysAgo * 86_400_000).toISOString();
      git(
        root,
        { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        commit.message ?? `commit ${commit.daysAgo}d ago`,
      );
    }
  }
  writeAll(files);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const DAY_MS = 86_400_000;
