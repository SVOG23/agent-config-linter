import { execFile } from 'node:child_process';

/** Depth 50 gives the staleness rule some history without full-clone cost. */
const CLONE_DEPTH = '50';

export function cloneRepo(url: string, dest: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['clone', '--quiet', '--depth', CLONE_DEPTH, '--', url, dest],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = stderr.trim().split('\n').pop() ?? error.message;
          reject(new Error(`clone failed: ${detail}`));
        } else {
          resolvePromise();
        }
      },
    );
  });
}
