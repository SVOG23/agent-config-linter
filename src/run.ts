import { readFileSync } from 'node:fs';
import { loadConfig, type ConfigOverrides } from './config.js';
import { openGit } from './git.js';
import { ALL_RULES } from './rules/index.js';
import { scan } from './scanner.js';
import type { CheckResult, ConfigFile, Finding, RuleContext, ScanResult } from './types.js';

export function runScan(root: string): ScanResult {
  return { root, files: scan(root).files };
}

export interface CheckOptions extends ConfigOverrides {
  nowMs?: number;
}

export function runCheck(root: string, opts: CheckOptions = {}): CheckResult {
  const { files, repoFiles } = scan(root);
  const config = loadConfig(root, { configPath: opts.configPath, rules: opts.rules });
  const cache = new Map<string, string>();

  const ctx: RuleContext = {
    root,
    files,
    repoFiles,
    git: openGit(root),
    config,
    read(file: ConfigFile): string {
      let content = cache.get(file.path);
      if (content === undefined) {
        content = readFileSync(file.absPath, 'utf8');
        cache.set(file.path, content);
      }
      return content;
    },
    nowMs: opts.nowMs ?? Date.now(),
  };

  const findings: Finding[] = [];
  for (const rule of ALL_RULES) {
    const settings = config.rules[rule.id];
    if (!settings?.enabled) continue;
    for (const finding of rule.check(ctx)) {
      findings.push(settings.severity ? { ...finding, severity: settings.severity } : finding);
    }
  }

  findings.sort(
    (a, b) =>
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule),
  );

  const summary = { errors: 0, warnings: 0, infos: 0 };
  for (const finding of findings) {
    if (finding.severity === 'error') summary.errors++;
    else if (finding.severity === 'warn') summary.warnings++;
    else summary.infos++;
  }

  // Read after the rules have run: `error` is only set once something actually
  // needed history, so a repo whose history nobody consulted costs no extra
  // git call and reports no failure.
  return { root, files, findings, summary, gitError: ctx.git?.error ?? null };
}
