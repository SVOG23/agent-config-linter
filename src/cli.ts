#!/usr/bin/env node
import { realpathSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { colorize } from './colors.js';
import { renderCheckJson, renderScanJson } from './report/json.js';
import { renderCheckText, renderScanText } from './report/terminal.js';
import { runCheck, runScan } from './run.js';

const USAGE = `aclint — lint AI agent config files (CLAUDE.md, AGENTS.md, .cursorrules, ...)

Usage:
  aclint scan  [path] [--json] [--no-color]
  aclint check [path] [--json] [--no-color] [--config <file>] [--rules <a,b>]

Commands:
  scan   Inventory agent config files (path, kind, size, last modified)
  check  Lint the files and report findings (exit 1 if any errors)

Options:
  --json           Machine-readable output for CI
  --no-color       Disable colored output
  --config <file>  Config file path (default: .agentlint.json)
  --rules <a,b>    Only run the listed rules
  -h, --help       Show this help
  -v, --version    Show version
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
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    path: null,
    json: false,
    color: true,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--no-color') parsed.color = false;
    else if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '-v' || arg === '--version') parsed.version = true;
    else if (arg === '--config' || arg === '--rules') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} requires a value`);
      if (arg === '--config') parsed.configPath = value;
      else parsed.rules = value.split(',').map((r) => r.trim()).filter(Boolean);
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
  if (args.command !== 'scan' && args.command !== 'check') {
    err.write(`Unknown command: ${args.command}\n\n${USAGE}`);
    return 2;
  }

  const root = resolve(cwd, args.path ?? '.');
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
    return result.summary.errors > 0 ? 1 : 0;
  } catch (error) {
    err.write(`aclint: ${(error as Error).message}\n`);
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
      process.stderr.write(`aclint: ${(error as Error).message}\n`);
      process.exit(2);
    },
  );
}
