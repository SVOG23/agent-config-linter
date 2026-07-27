import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { classify, SKIP_DIRS } from '../scanner.js';
import type { Finding, Rule, RuleContext } from '../types.js';
import { extractRefs, type ExtractedRef } from './refs.js';

/** Lines that admit the target may be absent ("read X, if it exists"). */
const HEDGED_LINE = /\bif (?:it |they |one )?(?:exists?|present|available)\b/i;

/** Mentions of config locations rather than claims that a repo file exists. */
function isConfigLocationMention(cleaned: string): boolean {
  if (classify(cleaned) !== null) return true; // e.g. `.claude/settings.json`, `CLAUDE.md`
  const segments = cleaned.split('/');
  const base = segments[segments.length - 1];
  if (base.includes('.local.')) return true; // local-by-design, never committed
  const parent = segments.length > 1 ? segments[segments.length - 2] : '';
  return base === 'settings.json' && parent.startsWith('.');
}

const MAX_PACKAGE_JSON_PARSES = 500;

/** Every directory path implied by the repo file list. */
function collectDirs(repoFiles: Set<string>): Set<string> {
  const dirs = new Set<string>();
  for (const path of repoFiles) {
    let end = path.lastIndexOf('/');
    while (end > 0) {
      const dir = path.slice(0, end);
      if (dirs.has(dir)) break;
      dirs.add(dir);
      end = dir.lastIndexOf('/');
    }
  }
  return dirs;
}

/** Union of script names across every package.json in the repo, or null if there are none. */
function collectScripts(ctx: RuleContext): Set<string> | null {
  const manifests = [...ctx.repoFiles]
    .filter((p) => p === 'package.json' || p.endsWith('/package.json'))
    .slice(0, MAX_PACKAGE_JSON_PARSES);
  if (manifests.length === 0) return null;
  const scripts = new Set<string>();
  for (const manifest of manifests) {
    try {
      const parsed = JSON.parse(readFileSync(join(ctx.root, ...manifest.split('/')), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      for (const name of Object.keys(parsed.scripts ?? {})) scripts.add(name);
    } catch {
      // unreadable manifest; ignore
    }
  }
  return scripts;
}

function candidatesFor(fileDir: string, value: string): string[] {
  const cleaned = value.replace(/^\//, '');
  const results: string[] = [];
  for (const base of [fileDir, '']) {
    const normalized = posix.normalize(base === '' ? cleaned : posix.join(base, cleaned));
    if (!normalized.startsWith('..') && !results.includes(normalized)) results.push(normalized);
  }
  return results;
}

/**
 * Instructions pointing at files or npm scripts that don't exist send agents
 * chasing ghosts. Tuned for precision on real repos: forgives context-relative
 * paths that exist deeper in a monorepo, build-output artifacts, and prose
 * tokens that aren't anchored to any real directory.
 */
export const brokenRefs: Rule = {
  id: 'broken-refs',
  check(ctx) {
    const findings: Finding[] = [];
    const dirs = collectDirs(ctx.repoFiles);
    let scripts: Set<string> | null | undefined;
    let repoFileList: string[] | undefined;

    const isBroken = (ref: ExtractedRef, fileDir: string, lineText: string): boolean => {
      const cleaned = ref.value.replace(/^\//, '');
      if (isConfigLocationMention(cleaned)) return false;
      if (HEDGED_LINE.test(lineText)) return false;
      const candidates = candidatesFor(fileDir, ref.value);
      if (candidates.length === 0) return false; // escapes the repo; cannot verify

      for (const candidate of candidates) {
        if (ctx.repoFiles.has(candidate)) return false;
        // Present on disk but gitignored (generated or local files) still counts.
        if (existsSync(join(ctx.root, ...candidate.split('/')))) return false;
      }

      // References into build output are expected to be absent from a fresh clone.
      if (cleaned.split('/').some((segment) => SKIP_DIRS.has(segment))) return false;

      // Context-relative prose: the exact path exists deeper in the monorepo.
      repoFileList ??= [...ctx.repoFiles];
      const suffix = `/${cleaned}`;
      if (repoFileList.some((p) => p.endsWith(suffix))) return false;

      if (ref.kind === 'path-token' && !/^\.\.?\//.test(ref.value)) {
        // Bare prose tokens (`vercel/next.js`, `react-dom/server.edge`) only count
        // as path claims when their first segment is a real directory.
        const first = cleaned.slice(0, cleaned.indexOf('/'));
        const anchored = candidatesFor(fileDir, first).some((c) => dirs.has(c));
        if (!anchored) return false;
      }
      return true;
    };

    for (const file of ctx.files) {
      if (!file.isInstruction) continue;
      const parent = posix.dirname(file.path);
      const fileDir = parent === '.' ? '' : parent;
      const seen = new Set<string>();
      const content = ctx.read(file);
      const lines = content.split('\n');

      for (const ref of extractRefs(content)) {
        const key = `${ref.kind}:${ref.value}`;
        if (seen.has(key)) continue;

        if (ref.kind === 'npm-script') {
          if (scripts === undefined) scripts = collectScripts(ctx);
          if (scripts === null || scripts.has(ref.value)) continue;
          seen.add(key);
          findings.push({
            rule: 'broken-refs',
            severity: 'error',
            file: file.path,
            line: ref.line,
            message: `No package.json in this repo has a script named "${ref.value}"`,
            suggestion: 'Update the instruction or add the script to package.json',
          });
          continue;
        }

        if (!isBroken(ref, fileDir, lines[ref.line - 1] ?? '')) continue;
        seen.add(key);
        findings.push({
          rule: 'broken-refs',
          severity: 'error',
          file: file.path,
          line: ref.line,
          message: `Referenced path "${ref.value}" does not exist in the repo`,
          suggestion: 'Fix the path or delete the stale reference',
        });
      }
    }
    return findings;
  },
};
