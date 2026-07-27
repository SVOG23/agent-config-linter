import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { classify, SKIP_DIRS } from '../scanner.js';
import type { Finding, Rule, RuleContext } from '../types.js';
import { extractRefs, fencedBlocks, type ExtractedRef } from './refs.js';

/** Lines that admit the target may be absent ("read X, if it exists", "unless the file already exists"). */
const HEDGED_LINE = /\b(?:if|unless)\b[^;!?\n]{0,60}?\b(?:exists?|present|available)\b/i;

/** Metasyntactic names mark example paths, not claims (`./foo.ts`, `src/xxx/xxxService.ts`, `test_EventNameHere.py`, `YYYY-MM-DD-topic.mdx`). */
const PLACEHOLDER =
  /(?:^|\/)(?:foo|bar|baz|qux|quux|yyy|zzz)(?:[./]|$)|(?:^|\/)xxx[\w-]*(?:[./]|$)|(?:^|\/)(?:my|your)[-_]?(?:command|file|app|module|project|script|test|class|func\w*|component|service|dir|folder|thing|example)s?\.\w{1,8}$|Here\.\w{1,8}$|YYYY[-_]MM[-_]DD|(?:file|dir|folder)[-_]name\./;

/** Lines that forbid creating the referenced file are not existence claims. */
const NEGATED_CREATE = /\b(?:don'?t|do not|never|avoid)\s+(?:propos|creat|add|mak|writ)/i;

/**
 * Lines describing the target as gone ("was removed in #1337", "has been
 * deleted", "is no longer read", "are obsolete") document history, not
 * existence claims. Imperatives ("Remove `x.ts` after upgrading") stay
 * flagged: they require a was/been/got auxiliary to match.
 */
const REMOVED_LINE =
  /\b(?:was|were|is|are|has been|have been|had been|got)\s+(?:since\s+|recently\s+|just\s+)?(?:removed|deleted|dropped|retired)\b|\bno longer\b|\bobsolete\b/i;

/**
 * Paths offered as illustrations ("Examples: `references/finance.md` for
 * schemas", "For example, a hook lives in ...") describe a shape, not a file
 * this repo contains. Common in skill docs, which teach patterns rather than
 * map the codebase.
 */
const ILLUSTRATIVE = /\b(?:for example|an example|e\.g\.|examples?\s*:)/i;

/** Conditional mood proposes a file worth creating rather than claiming one exists. */
const PROSPECTIVE = /\bwould\s+(?:be|need|go|live|contain|include|help)\b/i;

/**
 * True when git would ignore this path — expected to be absent from a fresh
 * clone. `--no-index` answers purely from the ignore rules, which is what we
 * want when asking about a directory that holds tracked files.
 */
function isGitIgnored(root: string, relPath: string, noIndex = false): boolean {
  const args = ['-C', root, 'check-ignore', '-q'];
  if (noIndex) args.push('--no-index');
  try {
    execFileSync('git', [...args, relPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

/**
 * Script names the instruction file defines itself, in a fenced package.json
 * snippet. Setup docs routinely show the scripts a reader is meant to create
 * and then invoke them; those are instructions, not stale references.
 */
function scriptsDefinedInDoc(content: string): Set<string> {
  const defined = new Set<string>();
  for (const block of fencedBlocks(content)) {
    const opening = /"scripts"\s*:\s*\{/.exec(block);
    if (!opening) continue;
    const start = opening.index + opening[0].length;
    let depth = 1;
    let end = start;
    while (end < block.length && depth > 0) {
      if (block[end] === '{') depth++;
      else if (block[end] === '}') depth--;
      end++;
    }
    for (const key of block.slice(start, end - 1).matchAll(/"([\w:.-]+)"\s*:/g)) {
      defined.add(key[1]!);
    }
  }
  return defined;
}

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
    let stemIndex: Map<string, string[]> | undefined;

    // The file the broken ref probably means now: same basename-minus-extension
    // elsewhere in the repo (renamed extension or moved directory).
    const findNearMiss = (value: string): string | null => {
      const base = value.slice(value.lastIndexOf('/') + 1);
      const stem = base.replace(/\.\w{1,8}$/, '');
      if (stem.length < 4) return null; // index, main, ... too generic
      if (stemIndex === undefined) {
        stemIndex = new Map();
        for (const path of ctx.repoFiles) {
          const b = path.slice(path.lastIndexOf('/') + 1);
          const s = b.replace(/\.\w{1,8}$/, '');
          const list = stemIndex.get(s);
          if (list) list.push(path);
          else stemIndex.set(s, [path]);
        }
      }
      const candidates = stemIndex.get(stem) ?? [];
      if (candidates.length === 0 || candidates.length > 3) return null;
      return [...candidates].sort((a, b) => a.length - b.length)[0];
    };

    // A config file can be committed inside a gitignored directory (a tracked
    // .cursor/rules file under an ignored `/.cursor`). Paths resolved beside it
    // inherit that ignore, which says nothing about whether they should exist —
    // without this, every reference in such a file would be forgiven.
    const dirIgnored = new Map<string, boolean>();
    const isDocDirIgnored = (fileDir: string): boolean => {
      if (fileDir === '' || !ctx.git) return false;
      let cached = dirIgnored.get(fileDir);
      if (cached === undefined) {
        cached = isGitIgnored(ctx.root, fileDir, true);
        dirIgnored.set(fileDir, cached);
      }
      return cached;
    };

    const isBroken = (ref: ExtractedRef, fileDir: string, lineText: string): boolean => {
      const cleaned = ref.value.replace(/^\//, '');
      if (isConfigLocationMention(cleaned)) return false;
      if (HEDGED_LINE.test(lineText) || NEGATED_CREATE.test(lineText) || REMOVED_LINE.test(lineText))
        return false;
      // Emphasis markers sit between the keyword and its colon: `- **Examples**:`.
      if (ILLUSTRATIVE.test(lineText.replace(/[*_]/g, ''))) return false;
      if (PROSPECTIVE.test(lineText)) return false;
      // GitHub web-path fragments (../blob/master/...) are URLs, not repo paths.
      if (/(?:^|\/)blob\/(?:master|main|HEAD|v?\d[\w.-]*)\//.test(cleaned)) return false;
      // .env files are created at setup time and gitignored by design.
      if (/^\.env(\..+)?$/.test(cleaned.slice(cleaned.lastIndexOf('/') + 1))) return false;
      if (PLACEHOLDER.test(cleaned)) return false;
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
      // A leading "./" is relative to whatever directory the doc tells the
      // reader to work from, which is rarely the doc's own directory.
      repoFileList ??= [...ctx.repoFiles];
      const suffix = `/${cleaned.replace(/^\.\//, '')}`;
      if (repoFileList.some((p) => p.endsWith(suffix))) return false;

      if (ref.kind === 'path-token' && !/^\.\.?\//.test(ref.value)) {
        // Bare prose tokens (`vercel/next.js`, `react-dom/server.edge`) only count
        // as path claims when their first segment is a real directory.
        const first = cleaned.slice(0, cleaned.indexOf('/'));
        const anchored = candidatesFor(fileDir, first).some((c) => dirs.has(c));
        if (!anchored) return false;
      }

      // Matches a gitignore rule: build output expected to be absent when fresh.
      const inheritsDocIgnore = isDocDirIgnored(fileDir);
      if (
        ctx.git &&
        candidates.some((c) =>
          inheritsDocIgnore && c.startsWith(`${fileDir}/`) ? false : isGitIgnored(ctx.root, c),
        )
      ) {
        return false;
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
      let localScripts: Set<string> | undefined;

      for (const ref of extractRefs(content)) {
        const key = `${ref.kind}:${ref.value}`;
        if (seen.has(key)) continue;

        if (ref.kind === 'npm-script') {
          if (/^[A-Za-z]$/.test(ref.value)) continue; // `bun run X` placeholders
          localScripts ??= scriptsDefinedInDoc(content);
          if (localScripts.has(ref.value)) continue;
          if (scripts === undefined) scripts = collectScripts(ctx);
          if (scripts === null) continue;
          // `npm run watch:` (from prose like "npm run watch:*") names a family.
          const found = ref.value.endsWith(':')
            ? [...scripts].some((s) => s.startsWith(ref.value))
            : scripts.has(ref.value);
          if (found) continue;
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
        const nearMiss = findNearMiss(ref.value);
        findings.push({
          rule: 'broken-refs',
          severity: 'error',
          file: file.path,
          line: ref.line,
          message: `Referenced path "${ref.value}" does not exist in the repo`,
          suggestion: nearMiss
            ? `Did you mean "${nearMiss}"? Otherwise fix the path or delete the stale reference`
            : 'Fix the path or delete the stale reference',
        });
      }
    }
    return findings;
  },
};
