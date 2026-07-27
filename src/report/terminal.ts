import type { Colors } from '../colors.js';
import type {
  CheckResult,
  ConfigFile,
  Finding,
  FleetRepoOutcome,
  FleetResult,
  ScanResult,
  Severity,
} from '../types.js';

function aliasNote(file: ConfigFile | undefined): string {
  return file?.aliases ? ` (also linked as ${file.aliases.join(', ')})` : '';
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function renderScanText(result: ScanResult, c: Colors): string {
  if (result.files.length === 0) {
    return 'No agent config files found.\n';
  }
  const lines = [c.bold(`Agent config files in ${result.root}`), ''];
  const width = Math.max(...result.files.map((f) => f.path.length));
  for (const file of result.files) {
    lines.push(
      `  ${file.path.padEnd(width)}  ${c.dim(
        `${file.kind}  ${formatSize(file.size).padStart(8)}  modified ${formatDate(file.mtimeMs)}${aliasNote(file)}`,
      )}`,
    );
  }
  lines.push('', `${result.files.length} file${result.files.length === 1 ? '' : 's'}`);
  return lines.join('\n') + '\n';
}

function symbol(severity: Severity, c: Colors): string {
  if (severity === 'error') return c.red('✖');
  if (severity === 'warn') return c.yellow('⚠');
  return c.blue('ℹ');
}

function renderFinding(finding: Finding, c: Colors): string[] {
  const location = finding.line !== null ? c.dim(`:${finding.line}`) : '';
  const lines = [
    `  ${symbol(finding.severity, c)} ${finding.message}${location} ${c.dim(`(${finding.rule})`)}`,
  ];
  if (finding.suggestion) {
    lines.push(`    ${c.dim(`→ ${finding.suggestion}`)}`);
  }
  return lines;
}

export function renderCheckText(result: CheckResult, c: Colors): string {
  const lines: string[] = [];

  if (result.findings.length === 0) {
    const scanned = result.files.length;
    return `${c.green('✔')} No issues found (${scanned} config file${scanned === 1 ? '' : 's'} checked).\n`;
  }

  const groups = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const key = finding.file ?? '(repository)';
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }

  const byPath = new Map(result.files.map((f) => [f.path, f]));
  for (const [file, findings] of groups) {
    const note = aliasNote(byPath.get(file));
    lines.push(note ? c.bold(file) + c.dim(note) : c.bold(file));
    for (const finding of findings) lines.push(...renderFinding(finding, c));
    lines.push('');
  }

  const { errors, warnings, infos } = result.summary;
  const parts = [
    `${errors} error${errors === 1 ? '' : 's'}`,
    `${warnings} warning${warnings === 1 ? '' : 's'}`,
  ];
  if (infos > 0) parts.push(`${infos} info`);
  const summaryText = parts.join(', ');
  lines.push(errors > 0 ? c.red(summaryText) : c.yellow(summaryText));
  return lines.join('\n') + '\n';
}

function gradeCell(outcome: FleetRepoOutcome, c: Colors): string {
  if (outcome.health === undefined || outcome.health === null) return c.dim('—');
  if (outcome.health === 'A') return c.green('A');
  if (outcome.health === 'B') return c.yellow('B');
  return c.red(outcome.health);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function topFinding(outcome: FleetRepoOutcome): Finding | undefined {
  const findings = outcome.findings ?? [];
  return findings.find((f) => f.severity === 'error') ?? findings[0];
}

export function renderFleetText(result: FleetResult, c: Colors): string {
  const scanned = result.repos.filter((r) => r.error === undefined);
  const failed = result.repos.filter((r) => r.error !== undefined);

  const header = ['Repo', 'Configs', 'Errors', 'Warnings', 'Health'];
  const rows = scanned.map((r) => [
    r.repo,
    String(r.configCount ?? 0),
    String(r.summary?.errors ?? 0),
    String(r.summary?.warnings ?? 0),
    r.health ?? '—',
  ]);
  const widths = header.map((h, col) =>
    Math.max(h.length, ...rows.map((row) => row[col]!.length)),
  );

  const lines: string[] = [c.bold(`Fleet report for ${result.target}`), ''];
  lines.push(
    '  ' + header.map((h, col) => (col === 0 ? h.padEnd(widths[col]!) : h.padStart(widths[col]!))).join('  '),
  );
  for (const [i, row] of rows.entries()) {
    const cells = row.map((cell, col) =>
      col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!),
    );
    // Re-render the grade cell with color after padding (ANSI codes break padStart widths).
    cells[4] = ' '.repeat(widths[4]! - 1) + gradeCell(scanned[i]!, c);
    lines.push('  ' + cells.join('  '));
  }

  const { totals } = result;
  lines.push(
    '',
    `${plural(totals.repos, 'repo')} scanned, ${totals.withConfigs} ${totals.withConfigs === 1 ? 'has' : 'have'} agent configs, ${totals.withFindings} ${totals.withFindings === 1 ? 'has' : 'have'} findings`,
    `${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')}`,
  );

  const offenders = scanned
    .filter((r) => (r.summary?.errors ?? 0) > 0)
    .sort((a, b) => (b.summary?.errors ?? 0) - (a.summary?.errors ?? 0))
    .slice(0, 5);
  if (offenders.length > 0) {
    lines.push('', c.bold('Worst offenders:'));
    for (const outcome of offenders) {
      const top = topFinding(outcome);
      lines.push(
        `  ${outcome.repo} ${c.red(`(${plural(outcome.summary?.errors ?? 0, 'error')})`)}`,
      );
      if (top) lines.push(`    ${c.dim(`${top.file ?? '(repository)'}: ${top.message}`)}`);
    }
  }

  if (failed.length > 0) {
    lines.push('', c.bold('Failed to scan:'));
    for (const outcome of failed) {
      lines.push(`  ${outcome.repo}: ${c.red(outcome.error!)}`);
    }
  }

  return lines.join('\n') + '\n';
}
