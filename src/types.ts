export type Severity = 'error' | 'warn' | 'info';

export type ConfigFileKind =
  | 'claude-md'
  | 'agents-md'
  | 'gemini-md'
  | 'cursorrules'
  | 'cursor-rule'
  | 'clinerules'
  | 'windsurfrules'
  | 'zed-rules'
  | 'goosehints'
  | 'claude-skill'
  | 'agent-skill'
  | 'claude-settings'
  | 'claude-command'
  | 'mcp-config'
  | 'copilot-instructions'
  | 'copilot-instruction';

export interface ConfigFile {
  /** Path relative to the scanned root, posix separators. */
  path: string;
  absPath: string;
  kind: ConfigFileKind;
  /** Size in bytes. */
  size: number;
  mtimeMs: number;
  /** Prose instruction files (markdown, .cursorrules) as opposed to JSON settings. */
  isInstruction: boolean;
  /** Other repo paths that are symlinks to this same physical file. */
  aliases?: string[];
}

export interface Finding {
  rule: string;
  severity: Severity;
  /** Relative path, or null for repo-level findings. */
  file: string | null;
  line: number | null;
  message: string;
  suggestion?: string;
}

export interface GitInfo {
  /** Last commit time touching this path, in ms. Null if never committed. */
  lastCommitMs(relPath: string): number | null;
  /** Number of commits on HEAD strictly after the given time. */
  commitsSince(unixMs: number): number;
  totalCommits(): number;
}

export interface RuleSettings {
  enabled: boolean;
  /** Overrides the severity of every finding this rule emits. */
  severity?: Severity;
  [threshold: string]: unknown;
}

export interface ResolvedConfig {
  rules: Record<string, RuleSettings>;
}

export interface RuleContext {
  root: string;
  files: ConfigFile[];
  /** Every file in the repo, relative posix paths. */
  repoFiles: Set<string>;
  /** Null when the root is not a git repository. */
  git: GitInfo | null;
  config: ResolvedConfig;
  /** Cached UTF-8 content read. */
  read(file: ConfigFile): string;
  /** Injected clock so staleness logic is testable. */
  nowMs: number;
}

export interface Rule {
  id: string;
  check(ctx: RuleContext): Finding[];
}

export interface ScanResult {
  root: string;
  files: ConfigFile[];
}

export interface CheckSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface CheckResult {
  root: string;
  files: ConfigFile[];
  findings: Finding[];
  summary: CheckSummary;
}
