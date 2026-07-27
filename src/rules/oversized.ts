import { threshold } from '../config.js';
import type { Finding, Rule } from '../types.js';

/**
 * Instruction files past a certain size stop working: models drop or dilute
 * rules buried in long context. Flags line counts and byte size.
 */
export const oversized: Rule = {
  id: 'oversized',
  check(ctx) {
    const settings = ctx.config.rules['oversized'];
    const warnLines = threshold(settings, 'warnLines', 100);
    const errorLines = threshold(settings, 'errorLines', 200);
    const warnBytes = threshold(settings, 'warnBytes', 10240);
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!file.isInstruction) continue;
      const content = ctx.read(file);
      // A trailing newline terminates the last line, it doesn't start a new one.
      const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      const kb = (file.size / 1024).toFixed(1);

      if (lineCount > errorLines) {
        findings.push({
          rule: 'oversized',
          severity: 'error',
          file: file.path,
          line: null,
          message: `${lineCount} lines (error threshold: ${errorLines}) — models reliably drop rules in files this long`,
          suggestion: 'Split into focused files (e.g. per-directory CLAUDE.md, skills) or cut low-value rules',
        });
      } else if (lineCount > warnLines) {
        findings.push({
          rule: 'oversized',
          severity: 'warn',
          file: file.path,
          line: null,
          message: `${lineCount} lines (warn threshold: ${warnLines}) — long instruction files get partially ignored`,
          suggestion: 'Tighten wording and move rarely-needed detail into referenced docs',
        });
      } else if (file.size > warnBytes) {
        findings.push({
          rule: 'oversized',
          severity: 'warn',
          file: file.path,
          line: null,
          message: `${kb}KB (warn threshold: ${(warnBytes / 1024).toFixed(0)}KB) — large instruction payload loaded every session`,
          suggestion: 'Trim dense content or move it into docs referenced on demand',
        });
      }
    }
    return findings;
  },
};
