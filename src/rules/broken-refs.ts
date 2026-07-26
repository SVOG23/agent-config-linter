import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Finding, Rule, RuleContext } from '../types.js';
import { extractRefs } from './refs.js';

function refExists(ctx: RuleContext, fileDir: string, value: string): boolean {
  const cleaned = value.replace(/^\//, '');
  const candidates = new Set<string>();
  for (const base of [fileDir, '']) {
    const normalized = posix.normalize(base === '' ? cleaned : posix.join(base, cleaned));
    if (!normalized.startsWith('..')) candidates.add(normalized);
  }
  if (candidates.size === 0) return true; // escapes the repo; cannot verify, stay quiet
  for (const candidate of candidates) {
    if (ctx.repoFiles.has(candidate)) return true;
    // Present on disk but gitignored (e.g. generated or local files) still counts.
    if (existsSync(join(ctx.root, ...candidate.split('/')))) return true;
  }
  return false;
}

function loadRootScripts(ctx: RuleContext): Set<string> | null {
  const pkgPath = join(ctx.root, 'package.json');
  if (!ctx.repoFiles.has('package.json') && !existsSync(pkgPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    return new Set(Object.keys(parsed.scripts ?? {}));
  } catch {
    return null;
  }
}

/**
 * Instructions pointing at files or npm scripts that don't exist send agents
 * chasing ghosts. Every flagged reference is verified against the repo file
 * list, the filesystem, and package.json.
 */
export const brokenRefs: Rule = {
  id: 'broken-refs',
  check(ctx) {
    const findings: Finding[] = [];
    let rootScripts: Set<string> | null | undefined;

    for (const file of ctx.files) {
      if (!file.isInstruction) continue;
      const fileDir = posix.dirname(file.path);
      const dir = fileDir === '.' ? '' : fileDir;
      const seen = new Set<string>();

      for (const ref of extractRefs(ctx.read(file))) {
        if (seen.has(`${ref.kind}:${ref.value}`)) continue;

        if (ref.kind === 'npm-script') {
          if (rootScripts === undefined) rootScripts = loadRootScripts(ctx);
          if (rootScripts === null || rootScripts.has(ref.value)) continue;
          seen.add(`${ref.kind}:${ref.value}`);
          findings.push({
            rule: 'broken-refs',
            severity: 'error',
            file: file.path,
            line: ref.line,
            message: `package.json has no script "${ref.value}"`,
            suggestion: 'Update the instruction or add the script to package.json',
          });
          continue;
        }

        if (refExists(ctx, dir, ref.value)) continue;
        seen.add(`${ref.kind}:${ref.value}`);
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
