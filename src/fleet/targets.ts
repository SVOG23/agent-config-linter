import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type FleetTarget =
  | { kind: 'github'; owner: string }
  | { kind: 'list'; path: string }
  | { kind: 'dir'; path: string };

export interface RepoSource {
  /** Display name, e.g. "owner/repo" or a local dir name. */
  name: string;
  /** Clone URL for remote sources. */
  url?: string;
  /** Existing local path for directory targets. */
  dir?: string;
}

export function parseTarget(raw: string, cwd: string): FleetTarget {
  if (raw.startsWith('gh:')) {
    const owner = raw.slice(3).trim();
    if (!owner) throw new Error('gh: target needs an owner, e.g. gh:vercel');
    return { kind: 'github', owner };
  }
  const path = resolve(cwd, raw);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new Error(`no such file or directory: ${path}`);
  }
  return stats.isDirectory() ? { kind: 'dir', path } : { kind: 'list', path };
}

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/** Derives "owner/repo" from a git URL's last two path segments. */
function nameFromUrl(url: string): string {
  const tail = url.replace(/\.git$/, '').replace(/^git@[^:]+:/, '');
  const segments = tail.split('/').filter(Boolean);
  return segments.slice(-2).join('/') || url;
}

export function sourcesFromList(path: string): RepoSource[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const sources: RepoSource[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (OWNER_REPO.test(line)) {
      sources.push({ name: line, url: `https://github.com/${line}.git` });
    } else {
      sources.push({ name: nameFromUrl(line), url: line });
    }
  }
  if (sources.length === 0) throw new Error(`no repos listed in ${path}`);
  return sources;
}

export function sourcesFromDir(path: string): RepoSource[] {
  const sources = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dir: join(path, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sources.length === 0) throw new Error(`no repos found in ${path} (expected subdirectories)`);
  return sources;
}
