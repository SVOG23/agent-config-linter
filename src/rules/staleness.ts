import { threshold } from '../config.js';
import type { Finding, Rule } from '../types.js';

const DAY_MS = 86_400_000;

/**
 * A config nobody has touched while the repo kept moving is probably
 * describing a codebase that no longer exists. Requires git history:
 * both age AND commit volume since must exceed thresholds.
 */
export const staleness: Rule = {
  id: 'staleness',
  check(ctx) {
    if (!ctx.git) return [];
    const settings = ctx.config.rules['staleness'];
    const maxAgeDays = threshold(settings, 'maxAgeDays', 90);
    const minCommitsSince = threshold(settings, 'minCommitsSince', 100);
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      const lastTouchedMs = ctx.git.lastCommitMs(file.path) ?? file.mtimeMs;
      const ageDays = Math.floor((ctx.nowMs - lastTouchedMs) / DAY_MS);
      if (ageDays <= maxAgeDays) continue;
      // +1s so the config's own commit is not counted as later activity.
      const commitsSince = ctx.git.commitsSince(lastTouchedMs + 1000);
      if (commitsSince <= minCommitsSince) continue;
      findings.push({
        rule: 'staleness',
        severity: 'warn',
        file: file.path,
        line: null,
        message: `Last updated ${ageDays} days ago, but the repo has had ${commitsSince} commits since — instructions likely describe an older codebase`,
        suggestion: 'Re-read the file against the current codebase and update or delete stale rules',
      });
    }
    return findings;
  },
};
