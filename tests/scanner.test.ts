import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scan } from '../src/scanner.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

function kinds(root: string): Record<string, string> {
  const result = scan(root);
  return Object.fromEntries(result.files.map((f) => [f.path, f.kind]));
}

describe('scan', () => {
  it('classifies every supported config file kind, including nested ones', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': '# root',
        'packages/api/CLAUDE.md': '# nested',
        'AGENTS.md': '# agents',
        '.cursorrules': 'rules',
        '.cursor/rules/style.mdc': 'rule',
        '.claude/skills/deploy/SKILL.md': '# skill',
        '.claude/settings.json': '{}',
        '.claude/commands/fix.md': '# cmd',
        '.mcp.json': '{}',
        '.github/copilot-instructions.md': '# copilot',
        'src/index.ts': 'code',
      }),
    );
    expect(kinds(repo.root)).toEqual({
      'CLAUDE.md': 'claude-md',
      'packages/api/CLAUDE.md': 'claude-md',
      'AGENTS.md': 'agents-md',
      '.cursorrules': 'cursorrules',
      '.cursor/rules/style.mdc': 'cursor-rule',
      '.claude/skills/deploy/SKILL.md': 'claude-skill',
      '.claude/settings.json': 'claude-settings',
      '.claude/commands/fix.md': 'claude-command',
      '.mcp.json': 'mcp-config',
      '.github/copilot-instructions.md': 'copilot-instructions',
    });
  });

  it('marks instruction files vs settings files', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': '# hi',
        '.mcp.json': '{}',
        '.claude/settings.json': '{}',
      }),
    );
    const byPath = new Map(scan(repo.root).files.map((f) => [f.path, f]));
    expect(byPath.get('CLAUDE.md')!.isInstruction).toBe(true);
    expect(byPath.get('.mcp.json')!.isInstruction).toBe(false);
    expect(byPath.get('.claude/settings.json')!.isInstruction).toBe(false);
  });

  it('populates size and mtime, and collects all repo files', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '12345', 'src/app.ts': 'x' }));
    const result = scan(repo.root);
    const claude = result.files.find((f) => f.path === 'CLAUDE.md')!;
    expect(claude.size).toBe(5);
    expect(claude.mtimeMs).toBeGreaterThan(0);
    expect(result.repoFiles.has('src/app.ts')).toBe(true);
    expect(result.repoFiles.has('CLAUDE.md')).toBe(true);
  });

  it('skips node_modules and similar directories when walking without git', () => {
    const repo = track(
      makeRepo({
        'node_modules/pkg/CLAUDE.md': '# vendored',
        'dist/CLAUDE.md': '# built',
        'CLAUDE.md': '# real',
      }),
    );
    expect(Object.keys(kinds(repo.root))).toEqual(['CLAUDE.md']);
  });

  it('respects .gitignore in git repos', () => {
    const repo = track(
      makeRepo(
        { 'ignored-dir/CLAUDE.md': '# ignored', 'CLAUDE.md': '# real' },
        { commits: [{ files: { '.gitignore': 'ignored-dir/\n' }, daysAgo: 1 }] },
      ),
    );
    const paths = Object.keys(kinds(repo.root));
    expect(paths).toContain('CLAUDE.md');
    expect(paths).not.toContain('ignored-dir/CLAUDE.md');
  });

  it('only classifies markdown files under .cursor/rules', () => {
    const repo = track(
      makeRepo({
        '.cursor/rules/style.mdc': 'rule',
        '.cursor/rules/notes.md': 'rule',
        '.cursor/rules/.DS_Store': 'binary junk',
      }),
    );
    expect(Object.keys(kinds(repo.root))).toEqual([
      '.cursor/rules/notes.md',
      '.cursor/rules/style.mdc',
    ]);
  });

  it('dedupes symlinked config files onto one physical file', () => {
    const repo = track(makeRepo({ 'AGENTS.md': '# canonical' }, { git: true }));
    symlinkSync('AGENTS.md', join(repo.root, 'CLAUDE.md'));
    const result = scan(repo.root);
    expect(result.files.map((f) => f.path)).toEqual(['AGENTS.md']);
    expect(result.files[0].aliases).toEqual(['CLAUDE.md']);
  });

  it('keeps the alphabetically first path even when it is the symlink', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': '# canonical' }, { git: true }));
    symlinkSync('CLAUDE.md', join(repo.root, 'AGENTS.md'));
    const result = scan(repo.root);
    expect(result.files.map((f) => f.path)).toEqual(['AGENTS.md']);
    expect(result.files[0].aliases).toEqual(['CLAUDE.md']);
  });

  it('finds nested tool directories in monorepos', () => {
    const repo = track(
      makeRepo({
        'apps/web/.cursorrules': 'rules',
        'apps/web/.claude/commands/gen.md': '# cmd',
        'libs/core/.mcp.json': '{}',
      }),
    );
    expect(kinds(repo.root)).toEqual({
      'apps/web/.cursorrules': 'cursorrules',
      'apps/web/.claude/commands/gen.md': 'claude-command',
      'libs/core/.mcp.json': 'mcp-config',
    });
  });
});
