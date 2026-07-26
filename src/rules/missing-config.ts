import { threshold } from '../config.js';
import type { Rule } from '../types.js';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.c', '.h', '.cpp', '.cc', '.cs',
  '.php', '.swift', '.kt', '.scala', '.sh',
]);

function extension(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

/**
 * An established code repo with zero agent config files means every AI
 * session starts from nothing. Only fires for git repos with real history
 * and real source code, so scratch dirs stay quiet.
 */
export const missingConfig: Rule = {
  id: 'missing-config',
  check(ctx) {
    if (ctx.files.length > 0 || !ctx.git) return [];
    const settings = ctx.config.rules['missing-config'];
    const minCommits = threshold(settings, 'minCommits', 20);
    const minSourceFiles = threshold(settings, 'minSourceFiles', 5);

    if (ctx.git.totalCommits() < minCommits) return [];
    let sourceCount = 0;
    for (const path of ctx.repoFiles) {
      if (SOURCE_EXTENSIONS.has(extension(path))) {
        sourceCount++;
        if (sourceCount >= minSourceFiles) break;
      }
    }
    if (sourceCount < minSourceFiles) return [];

    return [
      {
        rule: 'missing-config',
        severity: 'warn',
        file: null,
        line: null,
        message: 'Active code repository with no agent config files (CLAUDE.md, AGENTS.md, .cursorrules, ...)',
        suggestion: 'Add a CLAUDE.md or AGENTS.md describing build/test commands and project conventions',
      },
    ];
  },
};
