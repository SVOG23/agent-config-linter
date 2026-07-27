import type { Finding, Rule } from '../types.js';

interface Pattern {
  regex: RegExp;
  describe(match: string): string;
}

const PATTERNS: Pattern[] = [
  {
    // CI runners and generic example accounts are not personal machines.
    regex:
      /(?:\/(?:Users|home)\/(?!(?:runner|user|username|yourname|example)[/\\])[\w.-]+\/|[A-Za-z]:\\Users\\(?!(?:runner|user|username|yourname|example)[/\\])[\w.-]+\\)/,
    describe: (m) => `Machine-specific path "${m.replace(/[/\\]$/, '')}" — breaks for everyone else`,
  },
  {
    regex: /\bI (?:prefer|like|want|personally|usually|always use)\b/i,
    describe: (m) => `Personal preference ("${m}...") in a shared project file`,
  },
  {
    regex: /\bmy (?:machine|laptop|computer|home directory|local setup|editor)\b/i,
    describe: (m) => `Reference to "${m}" in a shared project file`,
  },
];

/**
 * Personal preferences and machine-specific paths leak into committed config
 * because the user -> project -> directory hierarchy is widely misunderstood.
 * They belong in user-level ~/.claude/CLAUDE.md, not in git.
 */
export const wrongLevel: Rule = {
  id: 'wrong-level',
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.isInstruction) continue;
      const base = file.path.slice(file.path.lastIndexOf('/') + 1);
      if (base.includes('.local.')) continue; // already a user-local file

      ctx.read(file)
        .split('\n')
        .forEach((text, index) => {
          for (const pattern of PATTERNS) {
            const match = text.match(pattern.regex);
            if (!match) continue;
            findings.push({
              rule: 'wrong-level',
              severity: 'warn',
              file: file.path,
              line: index + 1,
              message: pattern.describe(match[0]),
              suggestion: 'Move personal/machine-specific content to user-level ~/.claude/CLAUDE.md',
            });
            break; // one finding per line is enough
          }
        });
    }
    return findings;
  },
};
