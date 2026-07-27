import { statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { threshold } from '../config.js';
import type { Finding, Rule } from '../types.js';
import { extractRefs } from './refs.js';

/**
 * `@path` imports inline the whole target file into every session. A large
 * doc embedded this way costs context on tasks that never needed it.
 */
export const eagerEmbeds: Rule = {
  id: 'eager-embeds',
  check(ctx) {
    const maxEmbedBytes = threshold(ctx.config.rules['eager-embeds'], 'maxEmbedBytes', 10240);
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!file.isInstruction) continue;
      // A file that is nothing but one @-import (CLAUDE.md -> "@AGENTS.md") is
      // a deliberate alias, not an accidental embed.
      if (/^@\S+$/.test(ctx.read(file).trim())) continue;
      const fileDir = posix.dirname(file.path);
      const dir = fileDir === '.' ? '' : fileDir;
      const seen = new Set<string>();

      for (const ref of extractRefs(ctx.read(file))) {
        if (ref.kind !== 'at-import' || seen.has(ref.value)) continue;
        seen.add(ref.value);

        let size: number | null = null;
        for (const base of [dir, '']) {
          const normalized = posix.normalize(base === '' ? ref.value : posix.join(base, ref.value));
          if (normalized.startsWith('..')) continue;
          try {
            size = statSync(join(ctx.root, ...normalized.split('/'))).size;
            break;
          } catch {
            // try next base; missing targets are broken-refs' problem
          }
        }
        if (size === null || size <= maxEmbedBytes) continue;

        findings.push({
          rule: 'eager-embeds',
          severity: 'warn',
          file: file.path,
          line: ref.line,
          message: `@${ref.value} embeds ${(size / 1024).toFixed(1)}KB into every session`,
          suggestion: `Replace the @-import with a conditional pointer, e.g. "Read ${ref.value} when working on that area"`,
        });
      }
    }
    return findings;
  },
};
