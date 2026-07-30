#!/usr/bin/env node
import { realpathSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { colorize } from './colors.js';
import { runFleet } from './fleet/run.js';
import { renderCheckJson, renderFleetJson, renderScanJson } from './report/json.js';
import { renderCheckText, renderFleetText, renderScanText } from './report/terminal.js';
import { runCheck, runScan } from './run.js';

const USAGE = `unrot — lint AI agent config files (CLAUDE.md, AGENTS.md, .cursorrules, ...)

Usage:
  unrot scan  [path] [--json] [--no-color]
  unrot check [path] [--json] [--no-color] [--config <file>] [--rules <a,b>]
  unrot fleet <target> [--json] [--no-color] [--config <file>] [--concurrency <n>] [--keep] [--token <t>]

Commands:
  scan   Inventory agent config files (path, kind, size, last modified)
  check  Lint the files and report findings (exit 1 if any errors, 2 if the
         check could not complete)
  fleet  Scan many repos and print one combined health report (read-only)

Fleet targets:
  gh:<org-or-user>   List repos via the GitHub API (skips archived repos and forks)
  <file>             A file listing repos, one per line (owner/repo or a full git URL)
  <directory>        A local directory whose subdirectories are repos

Options:
  --json               Machine-readable output for CI
  --no-color           Disable colored output
  --config <file>      Config file path (default: .unrot.json, falling back to .agentlint.json)
  --rules <a,b>        Only run the listed rules (scan/check only)
  --concurrency <n>    Parallel repo scans for fleet (default 4)
  --keep               Keep fleet temp clones instead of deleting them
  --token <t>          GitHub token for gh: targets (or GITHUB_TOKEN env var)
  --include-archived   Include archived repos in gh: targets
  --include-forks      Include forks in gh: targets
  -h, --help           Show this help
  -v, --version        Show version
`;

export interface CliStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

interface ParsedArgs {
  command: string | null;
  path: string | null;
  json: boolean;
  color: boolean;
  configPath?: string;
  rules?: string[];
  concurrency?: number;
  keep: boolean;
  token?: string;
  includeArchived: boolean;
  includeForks: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    path: null,
    json: false,
    color: true,
    keep: false,
    includeArchived: false,
    includeForks: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--no-color') parsed.color = false;
    else if (arg === '--keep') parsed.keep = true;
    else if (arg === '--include-archived') parsed.includeArchived = true;
    else if (arg === '--include-forks') parsed.includeForks = true;
    else if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '-v' || arg === '--version') parsed.version = true;
    else if (arg === '--config' || arg === '--rules' || arg === '--concurrency' || arg === '--token') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} requires a value`);
      if (arg === '--config') parsed.configPath = value;
      else if (arg === '--token') parsed.token = value;
      else if (arg === '--concurrency') {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) {
          throw new UsageError(`--concurrency must be a positive integer, got: ${value}`);
        }
        parsed.concurrency = n;
      } else parsed.rules = value.split(',').map((r) => r.trim()).filter(Boolean);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (parsed.command === null) {
      parsed.command = arg;
    } else if (parsed.path === null) {
      parsed.path = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

class UsageError extends Error {}

function version(): string {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return pkg.version;
}

export async function runCli(
  argv: string[],
  cwd: string,
  out: CliStream,
  err: CliStream,
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    err.write(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (args.version) {
    out.write(`${version()}\n`);
    return 0;
  }
  if (args.help || args.command === null) {
    (args.help ? out : err).write(USAGE);
    return args.help ? 0 : 2;
  }
  if (args.command !== 'scan' && args.command !== 'check' && args.command !== 'fleet') {
    err.write(`Unknown command: ${args.command}\n\n${USAGE}`);
    return 2;
  }

  const fleetOnly: [string, boolean][] = [
    ['--concurrency', args.concurrency !== undefined],
    ['--keep', args.keep],
    ['--token', args.token !== undefined],
    ['--include-archived', args.includeArchived],
    ['--include-forks', args.includeForks],
  ];
  if (args.command !== 'fleet') {
    const used = fleetOnly.find(([, set]) => set);
    if (used) {
      err.write(`${used[0]} is only valid with the fleet command\n\n${USAGE}`);
      return 2;
    }
  } else if (args.rules) {
    err.write(`--rules is only valid with scan/check\n\n${USAGE}`);
    return 2;
  }

  if (args.command === 'fleet') {
    if (args.path === null) {
      err.write(`fleet requires a target (gh:<org>, a repo list file, or a directory)\n\n${USAGE}`);
      return 2;
    }
    const useColor =
      args.color && !args.json && out.isTTY === true && process.env['NO_COLOR'] === undefined;
    const colors = colorize(useColor);
    try {
      const result = await runFleet(args.path, cwd, {
        // Per-repo config resolution joins relative paths to each repo root;
        // one shared --config file must anchor to the invocation cwd instead.
        configPath: args.configPath === undefined ? undefined : resolve(cwd, args.configPath),
        concurrency: args.concurrency,
        keep: args.keep,
        token: args.token,
        includeArchived: args.includeArchived,
        includeForks: args.includeForks,
        onRepoDone: (outcome, done, total) => {
          const status = outcome.error !== undefined ? outcome.error : (outcome.health ?? '—');
          err.write(`[${done}/${total}] ${outcome.repo} — ${status}\n`);
        },
      });
      if (result.tempDir) err.write(`Kept clones in ${result.tempDir}\n`);
      out.write(args.json ? renderFleetJson(result) + '\n' : renderFleetText(result, colors));
      return result.totals.errors > 0 ? 1 : 0;
    } catch (error) {
      err.write(`unrot: ${(error as Error).message}\n`);
      return 2;
    }
  }

  const root = resolve(cwd, args.path ?? '.');
  let rootStats;
  try {
    rootStats = statSync(root);
  } catch {
    err.write(`unrot: no such directory: ${root}\n`);
    return 2;
  }
  if (!rootStats.isDirectory()) {
    err.write(`unrot: not a directory: ${root}\n`);
    return 2;
  }
  const useColor =
    args.color && !args.json && out.isTTY === true && process.env['NO_COLOR'] === undefined;
  const colors = colorize(useColor);

  try {
    if (args.command === 'scan') {
      const result = runScan(root);
      out.write(args.json ? renderScanJson(result) + '\n' : renderScanText(result, colors));
      return 0;
    }
    const result = runCheck(root, { configPath: args.configPath, rules: args.rules });
    out.write(args.json ? renderCheckJson(result) + '\n' : renderCheckText(result, colors));
    if (result.summary.errors > 0) return 1;
    // The check did not complete, so a 0 here would let CI pass on a repo
    // nothing verified. Shares 2 with other "could not run" exits.
    return result.gitError ? 2 : 0;
  } catch (error) {
    err.write(`unrot: ${(error as Error).message}\n`);
    return 2;
  }
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runCli(process.argv.slice(2), process.cwd(), process.stdout, process.stderr).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`unrot: ${(error as Error).message}\n`);
      process.exit(2);
    },
  );
}
