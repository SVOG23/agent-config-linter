import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CommitSpec {
  files: Record<string, string>;
  daysAgo: number;
  message?: string;
  /** Paths to stage with `git add -f`, for files a .gitignore rule would skip. */
  forceAdd?: string[];
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
    // Fixtures commit in a tight loop, which trips git's auto-maintenance. The
    // repack runs concurrently with the next commit and deletes the loose
    // objects that commit is still referencing, so git aborts with "invalid
    // object ... Error building trees". Seen only on the Linux CI runner (git
    // 2.54), where a broken fixture held 8 packfiles instead of none.
    git(root, null, 'config', 'gc.auto', '0');
    git(root, null, 'config', 'maintenance.auto', 'false');
    for (const commit of opts.commits ?? []) {
      writeAll(commit.files);
      git(root, null, 'add', '-A');
      if (commit.forceAdd) git(root, null, 'add', '-f', ...commit.forceAdd);
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
    // Fail loudly if the commits did not land. Silently short fixtures make
    // tests that expect findings fail while every test expecting none passes,
    // so the whole suite reads as "nothing to report" instead of "setup broke".
    if (opts.commits?.length) {
      const created = Number(git(root, null, 'rev-list', '--count', 'HEAD').trim());
      if (created !== opts.commits.length) {
        throw new Error(
          `makeRepo: asked for ${opts.commits.length} commits, git created ${created}`,
        );
      }
    }
  }
  writeAll(files);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const DAY_MS = 86_400_000;
