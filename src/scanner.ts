import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gitListFiles } from './git.js';
import type { ConfigFile, ConfigFileKind } from './types.js';

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'vendor',
  '.venv',
  'venv',
  'coverage',
  '.next',
  'target',
]);

interface Classification {
  kind: ConfigFileKind;
  isInstruction: boolean;
}

/**
 * Classifies a repo-relative posix path as an agent config file, or null.
 * Patterns match at any depth so monorepo sub-packages are covered.
 */
export function classify(path: string): Classification | null {
  const segments = path.split('/');
  const base = segments[segments.length - 1];

  if (base === 'CLAUDE.md' || base === 'CLAUDE.local.md') {
    return { kind: 'claude-md', isInstruction: true };
  }
  if (base === 'AGENTS.md') return { kind: 'agents-md', isInstruction: true };
  if (base === '.cursorrules') return { kind: 'cursorrules', isInstruction: true };
  if (base === '.mcp.json') return { kind: 'mcp-config', isInstruction: false };

  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === '.cursor' && segments[i + 1] === 'rules' && i + 1 < segments.length - 1) {
      return { kind: 'cursor-rule', isInstruction: true };
    }
    if (segments[i] === '.claude') {
      const rest = segments.slice(i + 1);
      if (rest[0] === 'skills' && base === 'SKILL.md') {
        return { kind: 'claude-skill', isInstruction: true };
      }
      if (rest.length === 1 && (base === 'settings.json' || base === 'settings.local.json')) {
        return { kind: 'claude-settings', isInstruction: false };
      }
      if (rest[0] === 'commands' && base.endsWith('.md')) {
        return { kind: 'claude-command', isInstruction: true };
      }
    }
    if (segments[i] === '.github' && base === 'copilot-instructions.md') {
      return { kind: 'copilot-instructions', isInstruction: true };
    }
  }
  return null;
}

function walk(root: string): string[] {
  const found: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = rel === '' ? root : join(root, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(childRel);
      } else if (entry.isFile()) {
        found.push(childRel);
      }
    }
  }
  return found;
}

export interface ScanOutput {
  files: ConfigFile[];
  repoFiles: Set<string>;
}

/** Discovers agent config files under `root` and the full repo file list. */
export function scan(root: string): ScanOutput {
  const listed = gitListFiles(root) ?? walk(root);
  const repoFiles = new Set(listed);
  const files: ConfigFile[] = [];

  for (const path of listed) {
    const classification = classify(path);
    if (!classification) continue;
    const absPath = join(root, ...path.split('/'));
    let stats;
    try {
      stats = statSync(absPath);
    } catch {
      continue; // listed by git but deleted from disk
    }
    files.push({
      path,
      absPath,
      kind: classification.kind,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      isInstruction: classification.isInstruction,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  // Symlinked configs (e.g. CLAUDE.md -> AGENTS.md) are one physical file;
  // keep the first path and record the rest as aliases so it lints once.
  const byRealPath = new Map<string, ConfigFile>();
  const deduped: ConfigFile[] = [];
  for (const file of files) {
    let realPath = file.absPath;
    try {
      realPath = realpathSync(file.absPath);
    } catch {
      // keep absPath; the file was stat-able above, so this is unlikely
    }
    const existing = byRealPath.get(realPath);
    if (existing) {
      (existing.aliases ??= []).push(file.path);
    } else {
      byRealPath.set(realPath, file);
      deduped.push(file);
    }
  }
  return { files: deduped, repoFiles };
}
