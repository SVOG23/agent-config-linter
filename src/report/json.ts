import type { CheckResult, ConfigFile, ScanResult } from '../types.js';

function fileEntry(file: ConfigFile) {
  return {
    path: file.path,
    kind: file.kind,
    size: file.size,
    modified: new Date(file.mtimeMs).toISOString(),
  };
}

export function renderScanJson(result: ScanResult): string {
  return JSON.stringify(
    { schemaVersion: 1, root: result.root, files: result.files.map(fileEntry) },
    null,
    2,
  );
}

export function renderCheckJson(result: CheckResult): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      root: result.root,
      files: result.files.map(fileEntry),
      findings: result.findings.map((f) => ({
        rule: f.rule,
        severity: f.severity,
        file: f.file,
        line: f.line,
        message: f.message,
        ...(f.suggestion ? { suggestion: f.suggestion } : {}),
      })),
      summary: result.summary,
    },
    null,
    2,
  );
}
