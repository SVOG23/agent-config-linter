import type { Colors } from '../colors.js';
import type { CheckResult, ConfigFile, Finding, ScanResult, Severity } from '../types.js';

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
