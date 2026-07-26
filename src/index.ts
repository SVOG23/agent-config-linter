export { runCheck, runScan, type CheckOptions } from './run.js';
export { renderCheckJson, renderScanJson } from './report/json.js';
export { renderCheckText, renderScanText } from './report/terminal.js';
export { colorize } from './colors.js';
export { DEFAULT_CONFIG, loadConfig } from './config.js';
export { ALL_RULES } from './rules/index.js';
export type {
  CheckResult,
  CheckSummary,
  ConfigFile,
  ConfigFileKind,
  Finding,
  ResolvedConfig,
  Rule,
  RuleContext,
  ScanResult,
  Severity,
} from './types.js';
