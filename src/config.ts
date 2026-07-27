import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ResolvedConfig, RuleSettings, Severity } from './types.js';

export const DEFAULT_CONFIG: ResolvedConfig = {
  rules: {
    staleness: { enabled: true, maxAgeDays: 90, minCommitsSince: 100 },
    'missing-config': { enabled: true, minCommits: 20, minSourceFiles: 5 },
    oversized: { enabled: true, warnLines: 100, errorLines: 200, warnBytes: 10240 },
    contradictions: { enabled: true },
    'broken-refs': { enabled: true },
    'wrong-level': { enabled: true },
    'eager-embeds': { enabled: true, maxEmbedBytes: 10240 },
  },
};

const SEVERITIES: ReadonlySet<string> = new Set(['error', 'warn', 'info']);

export interface ConfigOverrides {
  /** Path to a config file, relative to root or absolute. Default: .unrot.json, then .agentlint.json */
  configPath?: string;
  /** When set (e.g. from --rules), only these rules run. */
  rules?: string[];
}

export function knownRuleIds(): string[] {
  return Object.keys(DEFAULT_CONFIG.rules);
}

/** Reads a numeric threshold from rule settings, falling back to the built-in default. */
export function threshold(settings: RuleSettings, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function loadConfig(root: string, overrides: ConfigOverrides = {}): ResolvedConfig {
  const config: ResolvedConfig = {
    rules: Object.fromEntries(
      Object.entries(DEFAULT_CONFIG.rules).map(([id, settings]) => [id, { ...settings }]),
    ),
  };

  const explicitPath = overrides.configPath;
  let filePath: string;
  if (explicitPath) {
    filePath = isAbsolute(explicitPath) ? explicitPath : join(root, explicitPath);
  } else {
    // .unrot.json wins when both exist.
    const preferred = join(root, '.unrot.json');
    filePath = existsSync(preferred) ? preferred : join(root, '.agentlint.json');
  }

  if (explicitPath || existsSync(filePath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (cause) {
      throw new Error(`Could not read config ${filePath}: ${(cause as Error).message}`);
    }
    const userRules = (parsed as { rules?: Record<string, Record<string, unknown>> }).rules ?? {};
    for (const [id, settings] of Object.entries(userRules)) {
      const target = config.rules[id];
      if (!target) {
        throw new Error(`Unknown rule "${id}" in config. Known rules: ${knownRuleIds().join(', ')}`);
      }
      for (const [key, value] of Object.entries(settings)) {
        if (key === 'severity') {
          if (value === 'off') {
            target.enabled = false;
          } else if (typeof value === 'string' && SEVERITIES.has(value)) {
            target.severity = value as Severity;
          } else {
            throw new Error(`Invalid severity "${String(value)}" for rule "${id}" (use error, warn, info, or off)`);
          }
        } else if (key === 'enabled') {
          target.enabled = Boolean(value);
        } else {
          target[key] = value;
        }
      }
    }
  }

  if (overrides.rules) {
    for (const id of overrides.rules) {
      if (!config.rules[id]) {
        throw new Error(`Unknown rule "${id}". Known rules: ${knownRuleIds().join(', ')}`);
      }
    }
    const keep = new Set(overrides.rules);
    for (const [id, settings] of Object.entries(config.rules)) {
      settings.enabled = keep.has(id);
    }
  }

  return config;
}
