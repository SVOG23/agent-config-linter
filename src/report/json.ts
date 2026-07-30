import type { CheckResult, ConfigFile, Finding, FleetResult, ScanResult } from '../types.js';

function fileEntry(file: ConfigFile) {
  return {
    path: file.path,
    kind: file.kind,
    size: file.size,
    modified: new Date(file.mtimeMs).toISOString(),
    ...(file.aliases ? { aliases: file.aliases } : {}),
  };
}

export function renderScanJson(result: ScanResult): string {
  return JSON.stringify(
    { schemaVersion: 1, root: result.root, files: result.files.map(fileEntry) },
    null,
    2,
  );
}

function findingEntry(f: Finding) {
  return {
    rule: f.rule,
    severity: f.severity,
    file: f.file,
    line: f.line,
    message: f.message,
    ...(f.suggestion ? { suggestion: f.suggestion } : {}),
  };
}

export function renderCheckJson(result: CheckResult): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      root: result.root,
      files: result.files.map(fileEntry),
      findings: result.findings.map(findingEntry),
      summary: result.summary,
      // Non-null means history-based rules were skipped: consumers must not
      // read an empty findings list as a clean bill of health.
      gitError: result.gitError,
    },
    null,
    2,
  );
}

export function renderFleetJson(result: FleetResult): string {
  return JSON.stringify(
    {
      schemaVersion: 2,
      fleet: true,
      target: result.target,
      repos: result.repos.map((repo) =>
        repo.error !== undefined
          ? { repo: repo.repo, health: null, error: repo.error }
          : {
              repo: repo.repo,
              health: repo.health ?? null,
              summary: repo.summary,
              findings: (repo.findings ?? []).map(findingEntry),
            },
      ),
      totals: result.totals,
    },
    null,
    2,
  );
}
