import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { openGit } from '../src/git.js';
import { scan } from '../src/scanner.js';
import type { ResolvedConfig, RuleContext } from '../src/types.js';

export interface CtxOpts {
  nowMs?: number;
  config?: ResolvedConfig;
}

/** Builds a real RuleContext from a fixture directory. */
export function makeCtx(root: string, opts: CtxOpts = {}): RuleContext {
  const { files, repoFiles } = scan(root);
  const cache = new Map<string, string>();
  return {
    root,
    files,
    repoFiles,
    git: openGit(root),
    config: opts.config ?? loadConfig(root),
    read(file) {
      let content = cache.get(file.path);
      if (content === undefined) {
        content = readFileSync(file.absPath, 'utf8');
        cache.set(file.path, content);
      }
      return content;
    },
    nowMs: opts.nowMs ?? Date.now(),
  };
}
