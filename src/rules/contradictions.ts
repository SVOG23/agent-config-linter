import type { Finding, Rule, Severity } from '../types.js';

interface Claim {
  file: string;
  line: number;
  value: string;
}

interface Topic {
  id: string;
  name: string;
  /** 'conflict' fires on distinct values; 'duplicate' fires on 2+ files regardless. */
  mode: 'conflict' | 'duplicate';
  severity: Severity;
  extract(text: string, line: number, file: string): Claim | null;
}

const NEGATION = /(?:\bnot|n't|\bnever|\bavoid|\binstead of|\brather than)\s+(?:use\s+)?$/i;

function assertion(text: string, regex: RegExp, file: string, line: number): Claim | null {
  for (const match of text.matchAll(regex)) {
    if (match.index === undefined) continue;
    if (NEGATION.test(text.slice(Math.max(0, match.index - 20), match.index))) continue;
    return { file, line, value: match[1].toLowerCase() };
  }
  return null;
}

const TOPICS: Topic[] = [
  {
    id: 'package-manager',
    name: 'package manager',
    mode: 'conflict',
    severity: 'warn',
    extract: (text, line, file) =>
      assertion(text, /\b(?:use|prefer|always use|only use|install with)\s+(npm|pnpm|yarn|bun)\b/gi, file, line),
  },
  {
    id: 'indentation',
    name: 'indentation style',
    mode: 'conflict',
    severity: 'warn',
    extract(text, line, file) {
      if (/\buse tabs\b|\btabs? for indent/i.test(text)) return { file, line, value: 'tabs' };
      if (/\buse (?:\d+ )?spaces\b|\bindent with (?:\d+ )?spaces\b|\b\d+[- ]space indent/i.test(text)) {
        return { file, line, value: 'spaces' };
      }
      return null;
    },
  },
  {
    id: 'commit-style',
    name: 'commit message conventions',
    mode: 'duplicate',
    severity: 'info',
    extract(text, line, file) {
      if (/\bcommit (?:message|convention|format)s?\b|\bconventional commits?\b/i.test(text)) {
        return { file, line, value: 'commit-style' };
      }
      return null;
    },
  },
];

/**
 * When multiple config files in one repo assert different answers to the same
 * question, the agent gets whichever it read last. String-level heuristics
 * only — restricted to a few unambiguous topics to keep false positives near zero.
 */
export const contradictions: Rule = {
  id: 'contradictions',
  check(ctx) {
    const findings: Finding[] = [];

    for (const topic of TOPICS) {
      // First claim per topic per file.
      const claims = new Map<string, Claim>();
      for (const file of ctx.files) {
        if (!file.isInstruction) continue;
        const lines = ctx.read(file).split('\n');
        for (let i = 0; i < lines.length; i++) {
          const claim = topic.extract(lines[i], i + 1, file.path);
          if (claim) {
            claims.set(file.path, claim);
            break;
          }
        }
      }
      if (claims.size < 2) continue;

      const all = [...claims.values()];
      const distinctValues = new Set(all.map((c) => c.value));
      if (topic.mode === 'conflict' && distinctValues.size < 2) continue;

      for (const claim of all) {
        const others = all.filter((c) => c.file !== claim.file);
        const message =
          topic.mode === 'conflict'
            ? `Conflicting ${topic.name}: this file says "${claim.value}" but ${others
                .map((o) => `${o.file} says "${o.value}"`)
                .join(', ')}`
            : `${topic.name[0].toUpperCase()}${topic.name.slice(1)} defined here and in ${others
                .map((o) => o.file)
                .join(', ')}`;
        findings.push({
          rule: 'contradictions',
          severity: topic.severity,
          file: claim.file,
          line: claim.line,
          message,
          suggestion:
            topic.mode === 'conflict'
              ? 'Pick one and update the other file(s) to match'
              : 'Keep one source of truth and reference it from the other file(s)',
        });
      }
    }
    return findings;
  },
};
