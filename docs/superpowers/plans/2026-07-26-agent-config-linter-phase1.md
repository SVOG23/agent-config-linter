# Agent Config Linter — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-config `npx`-runnable CLI (`agentlint`) that inventories AI agent config files in a repo (`scan`) and lints them with seven high-confidence rules (`check`), with colored terminal + `--json` output and CI-friendly exit codes.

**Architecture:** A shared scanner discovers and classifies config files (using `git ls-files` when available, filesystem walk otherwise). Each lint rule is a small module implementing a common `Rule` interface against a `RuleContext`; an orchestrator runs enabled rules and hands findings to terminal/JSON reporters. All analysis is local and read-only: filesystem + `git` subprocess calls only.

**Tech Stack:** Node.js >= 18, TypeScript (ESM, `tsc` build), zero runtime dependencies (hand-rolled argv parsing + ANSI colors), vitest for tests.

**Spec:** `PROJECT_BRIEF.md` (committed at repo root). This plan implements Phase 1 only.

## Global Constraints

- Node.js + TypeScript, single npm package, runnable as `npx agent-config-linter` (bin name `agentlint`)
- Zero config required; optional `.agentlint.json` tunes thresholds and toggles rules
- No network calls, no telemetry, no LLM calls
- Read-only: never modify user files
- Fast on large repos (seconds) — prefer `git ls-files`, cache file reads, cap git subprocess calls
- One lint rule per file; rules individually toggleable; few high-confidence rules > many noisy ones
- Minimal dependencies (target: zero runtime deps)
- Test coverage on every lint rule
- Exit code non-zero from `check` iff any `error`-severity findings (CI gate)

---

## File Structure

```
package.json            ESM package, bin agentlint -> dist/cli.js, vitest+tsc dev deps
tsconfig.json           strict, NodeNext, outDir dist
.gitignore              node_modules, dist
src/types.ts            Severity, ConfigFileKind, ConfigFile, Finding, Rule, RuleContext, results
src/colors.ts           tiny ANSI helper (respects NO_COLOR and non-TTY)
src/git.ts              GitInfo: repo detection, per-file last-commit time, commit counts
src/scanner.ts          file discovery + classification -> ConfigFile[] and repoFiles set
src/config.ts           defaults, .agentlint.json loading/merging, CLI overrides
src/rules/index.ts      rule registry (ordered list of all rules)
src/rules/oversized.ts
src/rules/staleness.ts
src/rules/missing-config.ts
src/rules/broken-refs.ts
src/rules/wrong-level.ts
src/rules/eager-embeds.ts
src/rules/contradictions.ts
src/rules/refs.ts       shared reference-extraction helpers (@-imports, md links, path tokens)
src/run.ts              runScan(root, opts), runCheck(root, opts) orchestrators
src/report/terminal.ts  grouped, colored human output
src/report/json.ts      stable JSON schema (schemaVersion 1)
src/cli.ts              #!/usr/bin/env node, argv parsing, exit codes (0 ok / 1 errors / 2 crash)
tests/helpers.ts        makeFixtureRepo(): temp dir builder w/ optional git init + backdated commits
tests/*.test.ts         one test file per module/rule + cli integration
README.md               install, usage, rule list, config, JSON schema docs
```

## Core Interfaces (produced in Task 1, consumed everywhere)

```ts
export type Severity = 'error' | 'warn' | 'info';

export type ConfigFileKind =
  | 'claude-md' | 'agents-md' | 'cursorrules' | 'cursor-rule'
  | 'claude-skill' | 'claude-settings' | 'claude-command'
  | 'mcp-config' | 'copilot-instructions';

export interface ConfigFile {
  path: string;           // relative to root, posix separators
  absPath: string;
  kind: ConfigFileKind;
  size: number;           // bytes
  mtimeMs: number;
  isInstruction: boolean; // prose instruction files (md/.cursorrules) vs JSON settings
}

export interface Finding {
  rule: string;
  severity: Severity;
  file: string | null;    // null = repo-level finding
  line: number | null;
  message: string;
  suggestion?: string;
}

export interface GitInfo {
  lastCommitMs(relPath: string): number | null;
  commitsSince(unixMs: number): number;
  totalCommits(): number;
}

export interface RuleContext {
  root: string;
  files: ConfigFile[];
  repoFiles: Set<string>;               // all repo files, relative posix paths
  git: GitInfo | null;                  // null when not a git repo
  config: ResolvedConfig;
  read(file: ConfigFile): string;       // cached UTF-8 content
  nowMs: number;                        // injected clock for testability
}

export interface Rule {
  id: string;
  check(ctx: RuleContext): Finding[];
}
```

`ResolvedConfig` shape (Task 4): `{ rules: { [id]: { enabled: boolean, severity?: Severity, ...thresholds } } }` with defaults:

```json
{
  "rules": {
    "staleness":     { "enabled": true, "maxAgeDays": 90, "minCommitsSince": 100 },
    "missing-config":{ "enabled": true, "minCommits": 20, "minSourceFiles": 5 },
    "oversized":     { "enabled": true, "warnLines": 100, "errorLines": 200, "warnBytes": 10240 },
    "contradictions":{ "enabled": true },
    "broken-refs":   { "enabled": true },
    "wrong-level":   { "enabled": true },
    "eager-embeds":  { "enabled": true, "maxEmbedBytes": 10240 }
  }
}
```

---

### Task 1: Package scaffold + core types

**Files:** Create `package.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`, `src/colors.ts`, `tests/colors.test.ts`.

- [ ] package.json: name `agent-config-linter`, version 0.1.0, `"type": "module"`, bin `{"agentlint": "dist/cli.js"}`, engines node >=18, scripts: `build` (tsc), `test` (vitest run), `prepublishOnly` (build). Dev deps: typescript, vitest, @types/node. License MIT, repository URL.
- [ ] tsconfig: strict, module NodeNext, target ES2022, outDir dist, rootDir src, declaration true.
- [ ] `src/types.ts` exactly as in Core Interfaces above.
- [ ] `src/colors.ts`: `colorize(enabled)` returning `{red, yellow, blue, dim, bold, green}` string functions; plain passthrough when disabled.
- [ ] Test: colors produce ANSI codes when enabled, passthrough when disabled. Run `npx vitest run` → pass. Commit `chore: scaffold TypeScript package`.

### Task 2: Fixture helper + git.ts

**Files:** Create `tests/helpers.ts`, `src/git.ts`, `tests/git.test.ts`.

**Produces:** `makeRepo(files: Record<string,string>, opts?: {git?: boolean; commits?: Array<{files: Record<string,string>; daysAgo: number}>}) => { root: string; cleanup(): void }` — commits use `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` to backdate. `openGit(root): GitInfo | null` (null when not a repo); GitInfo per Core Interfaces, backed by `spawnSync('git', ...)` with caching (one `git log --format=%ct --name-only` pass or per-file `git log -1`; must not spawn per repo file — only per config file).

- [ ] Write failing tests: non-repo → null; repo with backdated commit → `lastCommitMs` returns backdated time for that file, null for uncommitted file; `commitsSince(t)` counts commits after t; `totalCommits()` correct.
- [ ] Implement `src/git.ts` minimal to pass. Run tests → pass. Commit `feat: git metadata helpers`.

### Task 3: Scanner

**Files:** Create `src/scanner.ts`, `tests/scanner.test.ts`.

**Produces:** `scan(root: string): { files: ConfigFile[]; repoFiles: Set<string> }`. Uses `git ls-files -z --cached --others --exclude-standard` when git repo (respects .gitignore); else recursive walk skipping `node_modules|.git|dist|build|out|vendor|.venv|venv|coverage|.next|target` at any depth. Classification table (match at any depth for monorepos):

| pattern | kind | isInstruction |
|---|---|---|
| basename CLAUDE.md / CLAUDE.local.md | claude-md | yes |
| basename AGENTS.md | agents-md | yes |
| basename .cursorrules | cursorrules | yes |
| under `.cursor/rules/` | cursor-rule | yes |
| `.claude/skills/**/SKILL.md` | claude-skill | yes |
| `.claude/settings.json` or `.claude/settings.local.json` | claude-settings | no |
| `.claude/commands/**/*.md` | claude-command | yes |
| basename .mcp.json | mcp-config | no |
| `.github/copilot-instructions.md` | copilot-instructions | yes |

- [ ] Failing tests: finds each kind at root and nested (e.g. `packages/a/CLAUDE.md`); skips node_modules in walk mode; respects .gitignore in git mode; repoFiles contains non-config files; sizes/mtimes populated.
- [ ] Implement, pass, commit `feat: config file scanner`.

### Task 4: Config loading

**Files:** Create `src/config.ts`, `tests/config.test.ts`.

**Produces:** `loadConfig(root: string, overrides?: {configPath?: string; rules?: string[]}): ResolvedConfig` — defaults above; deep-merge `.agentlint.json` if present; `rules` override (from `--rules a,b`) disables all others; `severity: "off"` in file == `enabled: false`; unknown rule names in config → throw with clear message.

- [ ] Failing tests: defaults when no file; threshold override merges; unknown rule errors; `--rules` narrowing; severity off disables.
- [ ] Implement, pass, commit `feat: config loading with .agentlint.json`.

### Task 5: Rule — oversized

**Files:** Create `src/rules/oversized.ts`, `tests/oversized.test.ts`, `src/rules/index.ts` (registry, extended in later tasks), `tests/rulehelpers.ts` (`makeCtx` building a RuleContext from a fixture dir).

Logic: instruction files only. lines > errorLines → error; else lines > warnLines → warn; else bytes > warnBytes → warn. One finding per file, message states measured value + threshold, suggestion "split or tighten; models drop rules in long files".

- [ ] Failing tests: 250-line CLAUDE.md → error; 150 → warn; 50 small → none; 50-line but 11KB → warn (bytes); .mcp.json 300 lines → none (not instruction); thresholds honored from config.
- [ ] Implement, pass, commit `feat: oversized rule`.

### Task 6: Rule — staleness

**Files:** Create `src/rules/staleness.ts`, `tests/staleness.test.ts`.

Logic: git repos only (skip when `ctx.git` null). Per config file: cfgTime = `git.lastCommitMs(path)` ?? mtimeMs. ageDays = (nowMs − cfgTime)/86_400_000. Flag warn iff ageDays > maxAgeDays AND `git.commitsSince(cfgTime)` > minCommitsSince. Message includes both numbers.

- [ ] Failing tests (using backdated fixture commits + injected nowMs): old config + 150 later commits → warn; old config + 5 commits → none; fresh config + many commits → none; non-git → none.
- [ ] Implement, pass, commit `feat: staleness rule`.

### Task 7: Rule — missing-config

**Files:** Create `src/rules/missing-config.ts`, `tests/missing-config.test.ts`.

Logic: fires only when `ctx.files.length === 0`, git repo, `totalCommits() >= minCommits`, and repoFiles contains >= minSourceFiles files with source extensions (`.ts .tsx .js .jsx .mjs .py .go .rs .java .rb .c .h .cpp .cc .cs .php .swift .kt .scala .sh`). Emits single repo-level warn (file: null) suggesting starting with CLAUDE.md/AGENTS.md.

- [ ] Failing tests: active repo w/o configs → warn; repo with a CLAUDE.md → none; 3-commit repo → none; docs-only repo → none; non-git → none.
- [ ] Implement, pass, commit `feat: missing-config rule`.

### Task 8: Shared ref extraction + Rule — broken-refs

**Files:** Create `src/rules/refs.ts`, `src/rules/broken-refs.ts`, `tests/broken-refs.test.ts`.

`refs.ts` produces: `extractRefs(content: string): Array<{kind: 'at-import'|'md-link'|'path-token'|'npm-script', value: string, line: number}>`:
- at-import: `/(^|\s)@([\w.~-]+\/[\w./~-]+|[\w.-]+\.\w{1,8})/gm` — must contain `/` or end with an extension; skip `@scope/pkg`-shaped values with no extension; skip values starting `~` (user-level, unverifiable); skip emails (preceding char alphanumeric).
- md-link: `[text](target)` where target not starting `http`, `#`, `mailto:`; strip `#anchor`/`?query`.
- path-token: inline backtick content matching `/^\.{0,2}[\w.-]+(\/[\w.-]+)+$/` with a file extension in last segment; reject tokens containing `* < > { } $ |` or spaces.
- npm-script: `/\b(?:npm|pnpm) run ([\w:.-]+)|\byarn (?:run )?([\w:.-]+)/g` (yarn form only when word isn't a known builtin: install/add/build? — restrict to `npm run`/`pnpm run` for confidence).

`broken-refs.ts`: instruction files only. For path-like refs, resolve against config file's dir AND repo root; broken iff neither exists in `repoFiles` (also `fs.existsSync` fallback for gitignored-but-present files → not broken). npm-script refs: only checked when root `package.json` exists and parses; broken iff script missing. Severity error. Suggestion names nearest fix.

- [ ] Failing tests: `@docs/missing.md` → error w/ line; `@docs/exists.md` → none; md link to missing file → error; `http` link → none; backtick `scripts/build.sh` missing → error; `npm run nope` w/ package.json lacking script → error; `npm run test` present → none; placeholder `<file>` and `@scope/pkg` → none; ref valid relative to file dir → none.
- [ ] Implement, pass, commit `feat: broken-refs rule`.

### Task 9: Rule — wrong-level

**Files:** Create `src/rules/wrong-level.ts`, `tests/wrong-level.test.ts`.

Logic: instruction files, excluding basenames containing `.local.` (already user-local). Patterns (warn, one finding per line matched, suggestion "move to user-level ~/.claude/CLAUDE.md"):
- absolute home paths: `/\/(?:Users|home)\/[\w.-]+\//` and `/[A-Z]:\\Users\\[\w.-]+\\/`
- first-person prefs: `/\bI (?:prefer|like|want|personally|usually|always use)\b/i`
- possessives: `/\bmy (?:machine|laptop|computer|home directory|local|editor)\b/i`

- [ ] Failing tests: `/Users/alice/dev/proj` in CLAUDE.md → warn w/ line; `I prefer tabs` → warn; `my machine` → warn; clean file → none; CLAUDE.local.md with prefs → none; `# Users can...` (no path) → none.
- [ ] Implement, pass, commit `feat: wrong-level rule`.

### Task 10: Rule — eager-embeds

**Files:** Create `src/rules/eager-embeds.ts`, `tests/eager-embeds.test.ts`.

Logic: instruction files; reuse `extractRefs` at-imports; resolve (file dir then root); if target exists and size > maxEmbedBytes → warn: "@-import embeds NkB into every session"; suggestion: replace with conditional pointer ("Read docs/x.md when working on Y").

- [ ] Failing tests: `@docs/big.md` (15KB fixture) → warn; `@docs/small.md` (1KB) → none; missing target → none (broken-refs owns that); threshold from config honored.
- [ ] Implement, pass, commit `feat: eager-embeds rule`.

### Task 11: Rule — contradictions

**Files:** Create `src/rules/contradictions.ts`, `tests/contradictions.test.ts`.

Logic (string/heuristic, cross-file, high-confidence only):
1. **Package-manager conflict (warn):** per file, collect managers from `/\b(?:use|using|prefer|run|via|with)\s+(npm|pnpm|yarn|bun)\b/i` plus `(npm|pnpm|yarn|bun) (?:install|run|ci)` command mentions; if ≥2 distinct managers *asserted as the tool to use* (`use|prefer|always`-form only) across files → one warn finding on each involved file naming the others.
2. **Indentation conflict (warn):** `use tabs` vs `use spaces` (or `tabs for indentation` / `N-space indent`) asserted in different files.
3. **Commit-convention duplication (info):** ≥2 files matching `/commit (?:message|convention|format)|conventional commits/i` → info on each: "commit conventions defined in multiple files; consolidate".

- [ ] Failing tests: CLAUDE.md "use pnpm" + .cursorrules "use npm" → 2 warns naming counterpart; both say pnpm → none; command-mention only (`npm run test` example) + "use pnpm" → none (assertion-form required); tabs vs spaces conflict → warns; two files with commit conventions → 2 infos; single file both topics → none.
- [ ] Implement, pass, commit `feat: contradictions rule`.

### Task 12: Orchestrator + reporters

**Files:** Create `src/run.ts`, `src/report/terminal.ts`, `src/report/json.ts`, `tests/run.test.ts`, `tests/report.test.ts`.

**Produces:**
- `runScan(root): ScanResult` = `{ root, files }`
- `runCheck(root, opts: {configPath?, rules?, nowMs?}): CheckResult` = `{ root, files, findings, summary: {errors, warnings, infos} }` — builds ctx (scanner+git+config), runs enabled rules in registry order, applies per-rule severity override, sorts findings by file then line.
- `renderScanText/renderCheckText(result, colors)` — check output grouped by file, `(repository)` group for file:null, per-finding `✖/⚠/ℹ [line] message (rule)`, summary line; "No agent config files found." / "No issues found." empty states.
- `renderScanJson/renderCheckJson(result)` — `{ schemaVersion: 1, root, files: [{path, kind, size, modified}], findings: [...], summary }`, stable key order, ISO dates.

- [ ] Failing tests: fixture repo w/ seeded issues → findings from multiple rules aggregated + sorted; disabled rule absent; severity override applied; JSON parses and matches schema; text contains group headers and summary.
- [ ] Implement, pass, commit `feat: check/scan orchestrator and reporters`.

### Task 13: CLI

**Files:** Create `src/cli.ts`, `tests/cli.test.ts`.

**Produces:** `runCli(argv: string[], cwd: string, out: Writable, err: Writable): Promise<number>` exported for tests; `main()` guarded by `import.meta.url` check calls `process.exit(await runCli(...))`. Usage:

```
agentlint scan [path] [--json] [--no-color]
agentlint check [path] [--json] [--no-color] [--config <file>] [--rules <a,b>]
agentlint --help | --version
```

Exit codes: 0 clean, 1 = `check` found ≥1 error finding, 2 = usage/crash (message to stderr). Color auto-off when `--json`, `NO_COLOR`, or non-TTY.

- [ ] Failing tests (in-process runCli): scan lists fixture files; check on repo with an error-finding → exit 1; clean repo → 0; unknown command → 2 + usage; `--json` parses; `--rules oversized` runs only that rule.
- [ ] Implement, pass, commit `feat: CLI entrypoint`.
- [ ] Build (`npm run build`) and smoke `node dist/cli.js check .` on this repo. Commit fixes if any.

### Task 14: README + polish

**Files:** Modify `README.md`.

- [ ] Sections: what/why, install (`npx agent-config-linter check`), commands, full rule table (id, severity, what it catches, thresholds), `.agentlint.json` example, JSON output schema example, exit codes, Phase-1 scope note (read-only, no network). Commit `docs: README`.

### Task 15: Real-world validation (definition-of-done)

- [ ] Shallow-clone a set of real OSS repos (with agent configs where possible) into scratchpad; run built `agentlint scan` + `check` on each; require: no crashes, findings look sane (spot-check for false positives; tune rule heuristics if any FP class appears — repeat tests after tuning).
- [ ] Run `agentlint check` on repos with no configs and non-git dirs (edge cases: empty dir, binary-heavy dir).
- [ ] Full test suite green. Commit any tuning as `fix:` commits.

### Task 16: Ship

- [ ] `npm run build && npm test` green; `npm pack --dry-run` shows only dist/README/LICENSE/package.json.
- [ ] Push to origin main.
