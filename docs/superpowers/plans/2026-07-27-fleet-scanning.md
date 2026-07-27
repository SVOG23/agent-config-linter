# `unrot fleet` (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `unrot fleet <target>` command that scans many repos (GitHub org/user, repo-list file, or local directory) with the existing check engine and prints one combined health report.

**Architecture:** A new `src/fleet/` module resolves the target into repo sources, shallow-clones remote repos into a temp dir, runs the existing `runCheck` on each with a concurrency pool, and aggregates per-repo outcomes (including failures) into a `FleetResult`. New renderers in `src/report/` produce the terminal table and schemaVersion-2 JSON. The CLI grows a `fleet` command with fleet-only flags.

**Tech Stack:** TypeScript (ESM, NodeNext), zero runtime deps. GitHub REST via built-in `fetch` (injectable for tests), cloning via system `git` through `child_process.execFile`. Vitest for tests.

## Global Constraints

- Zero runtime dependencies; `git` is a documented system requirement, not a dependency.
- Read-only against scanned repos; never write outside the run's temp dir.
- No telemetry, no LLM calls.
- Single-repo JSON output stays schemaVersion 1 and unchanged; fleet JSON is schemaVersion 2.
- Individual repo failures must never crash the run.
- Stream per-repo results as they complete (progress lines to stderr) rather than waiting for all.
- Version bump: the brief says 0.3.0, but the repo already ships 0.4.0 (brief predates two releases) → bump to **0.5.0**. Do not publish.
- Rate-limited GitHub responses produce a clear error suggesting `--token`.
- Default clone depth 50; document that full history gives better staleness results.

---

### Task 1: Fleet types + health grading

**Files:**
- Modify: `src/types.ts` (append fleet types)
- Create: `src/fleet/health.ts`
- Test: `tests/fleet-health.test.ts`

**Interfaces:**
- Produces: `HealthGrade`, `FleetRepoOutcome`, `FleetTotals`, `FleetResult` types; `healthGrade(summary: CheckSummary, configCount: number): HealthGrade`.

- [x] **Step 1: Add types to `src/types.ts`**

```ts
/** A = no findings, B = findings but no errors, C = 1-2 errors, D = 3+ errors, null = no configs. */
export type HealthGrade = 'A' | 'B' | 'C' | 'D' | null;

export interface FleetRepoOutcome {
  repo: string;
  /** Present when the repo was scanned. */
  health?: HealthGrade;
  summary?: CheckSummary;
  findings?: Finding[];
  configCount?: number;
  /** Present when the repo failed to clone or scan. */
  error?: string;
}

export interface FleetTotals {
  repos: number;
  withConfigs: number;
  withFindings: number;
  errors: number;
  warnings: number;
}

export interface FleetResult {
  target: string;
  repos: FleetRepoOutcome[];
  totals: FleetTotals;
}
```

- [x] **Step 2: Write failing test `tests/fleet-health.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { healthGrade } from '../src/fleet/health.js';

const summary = (errors = 0, warnings = 0, infos = 0) => ({ errors, warnings, infos });

describe('healthGrade', () => {
  it('grades null when the repo has no agent configs', () => {
    expect(healthGrade(summary(), 0)).toBeNull();
  });
  it('grades A for configs with no findings', () => {
    expect(healthGrade(summary(), 2)).toBe('A');
  });
  it('grades B for warnings or infos only', () => {
    expect(healthGrade(summary(0, 3), 1)).toBe('B');
    expect(healthGrade(summary(0, 0, 1), 1)).toBe('B');
  });
  it('grades C for 1-2 errors', () => {
    expect(healthGrade(summary(1), 1)).toBe('C');
    expect(healthGrade(summary(2, 5), 1)).toBe('C');
  });
  it('grades D for 3+ errors', () => {
    expect(healthGrade(summary(3), 1)).toBe('D');
  });
});
```

- [x] **Step 3: Implement `src/fleet/health.ts`**

```ts
import type { CheckSummary, HealthGrade } from '../types.js';

export function healthGrade(summary: CheckSummary, configCount: number): HealthGrade {
  if (configCount === 0) return null;
  if (summary.errors >= 3) return 'D';
  if (summary.errors >= 1) return 'C';
  if (summary.warnings > 0 || summary.infos > 0) return 'B';
  return 'A';
}
```

- [x] **Step 4: `npm run build && npx vitest run tests/fleet-health.test.ts` → PASS; commit**

### Task 2: Target parsing + repo-list file parsing

**Files:**
- Create: `src/fleet/targets.ts`
- Test: `tests/fleet-targets.test.ts`

**Interfaces:**
- Produces: `FleetTarget` union; `RepoSource { name, url?, dir? }`; `parseTarget(raw: string, cwd: string): FleetTarget`; `sourcesFromList(path: string): RepoSource[]`; `sourcesFromDir(path: string): RepoSource[]`.

- [x] **Step 1: Failing tests** — `gh:` prefix parses to `{kind:'github', owner}`; empty owner rejected; directory path → `dir`; file path → `list`; missing path → clear error. List parsing: `owner/repo` lines → `https://github.com/owner/repo.git`, full URLs kept verbatim (name derived from last two path segments, `.git` stripped), blank lines and `#` comments skipped, empty list rejected. Dir parsing: immediate subdirectories only, sorted, name = dirname; empty dir rejected.

- [x] **Step 2: Implement**

```ts
export type FleetTarget =
  | { kind: 'github'; owner: string }
  | { kind: 'list'; path: string }
  | { kind: 'dir'; path: string };

export interface RepoSource {
  /** Display name, e.g. "owner/repo" or a local dir name. */
  name: string;
  /** Clone URL for remote sources. */
  url?: string;
  /** Existing local path for directory targets. */
  dir?: string;
}

export function parseTarget(raw: string, cwd: string): FleetTarget; // gh: → github; stat() → dir/list; else throw
export function sourcesFromList(path: string): RepoSource[];
export function sourcesFromDir(path: string): RepoSource[];
```

- [x] **Step 3: build + test → PASS; commit**

### Task 3: GitHub repo listing (mocked fetch)

**Files:**
- Create: `src/fleet/github.ts`
- Test: `tests/fleet-github.test.ts`

**Interfaces:**
- Produces: `listGithubRepos(owner: string, opts: { token?: string; includeArchived?: boolean; includeForks?: boolean; fetchImpl?: typeof fetch }): Promise<RepoSource[]>`.

- [x] **Step 1: Failing tests with a fake `fetchImpl`:** org listing maps `full_name`/`clone_url`; archived and forks skipped by default, included with flags; pagination (two pages of 100); 404 on `/orgs/` falls back to `/users/`; both 404 → "not found" error; 403 with `x-ratelimit-remaining: 0` → error mentioning `--token`; 401 → bad-credentials error; empty org → `[]`; token sent as `Authorization: Bearer`.

- [x] **Step 2: Implement** — paginate `per_page=100` until a short page; headers `Accept: application/vnd.github+json`, `User-Agent: unrot`, optional bearer token from opts.

- [x] **Step 3: build + test → PASS; commit**

### Task 4: Shallow clone helper

**Files:**
- Create: `src/fleet/clone.ts`
- Test: `tests/fleet-clone.test.ts` (clones a local fixture repo via `file://` URL — no network)

**Interfaces:**
- Produces: `cloneRepo(url: string, dest: string): Promise<void>` — `git clone --quiet --depth 50`, `GIT_TERMINAL_PROMPT=0`, rejects with trimmed stderr in the message.

- [x] **Steps: failing test (clone fixture succeeds and yields working tree; bogus URL rejects with message) → implement → build + test PASS → commit**

### Task 5: Fleet orchestrator (concurrency + failure isolation)

**Files:**
- Create: `src/fleet/run.ts`
- Test: `tests/fleet-run.test.ts`

**Interfaces:**
- Consumes: `parseTarget`, `sourcesFromList`, `sourcesFromDir`, `listGithubRepos`, `cloneRepo`, `runCheck`, `healthGrade`.
- Produces:

```ts
export interface FleetOptions {
  configPath?: string;
  concurrency?: number; // default 4
  keep?: boolean;
  token?: string;
  includeArchived?: boolean;
  includeForks?: boolean;
  fetchImpl?: typeof fetch;
  onRepoDone?(outcome: FleetRepoOutcome, done: number, total: number): void;
}
export interface FleetRunResult extends FleetResult {
  /** Set when clones were kept via `keep`. */
  tempDir?: string;
}
export async function runFleet(rawTarget: string, cwd: string, opts?: FleetOptions): Promise<FleetRunResult>;
```

- [x] **Step 1: Failing tests:** local multi-repo fixture dir (clean repo → A, warning repo → B, error repo → C/D, no-config repo → null) with correct totals; result order matches input order despite concurrency; a failing source (bogus URL in a list) becomes an `error` outcome without killing the run; `onRepoDone` fires once per repo with running counts; temp dir removed by default, kept with `keep: true`; list target with `file://` URLs actually clones and scans.

- [x] **Step 2: Implement** — resolve sources; `mkdtemp` under `os.tmpdir()` only when remote sources exist; worker pool of size `concurrency`; per-repo try/catch → outcome; totals computed at the end; cleanup with `rmSync(recursive, force)` unless `keep`.

- [x] **Step 3: build + test → PASS; commit**

### Task 6: Fleet reports (terminal table + JSON v2)

**Files:**
- Modify: `src/report/terminal.ts` (add `renderFleetText`), `src/report/json.ts` (add `renderFleetJson`)
- Test: `tests/fleet-report.test.ts`

**Interfaces:**
- Produces: `renderFleetText(result: FleetResult, c: Colors): string`; `renderFleetJson(result: FleetResult): string`.

- [x] **Step 1: Failing tests:** table has one row per repo with Repo/Configs/Errors/Warnings/Health columns; no-config repos show `—`; totals block ("X repos scanned, Y have agent configs, Z have findings", total errors/warnings); worst offenders = top 5 by errors with each repo's top finding message; failed repos listed at the end with reason; JSON parses, `schemaVersion === 2`, `fleet === true`, repo entries match the brief's shape (failure entries: `health: null` + `error`), finding objects identical to v1 shape.

- [x] **Step 2: Implement; build + test → PASS; commit**

### Task 7: CLI `fleet` command

**Files:**
- Modify: `src/cli.ts` (usage text, flags `--concurrency <n> --keep --token <t> --include-archived --include-forks`, `fleet` dispatch), `src/index.ts` (export fleet API)
- Test: `tests/fleet-cli.test.ts`

**Interfaces:**
- Consumes: `runFleet`, `renderFleetText`, `renderFleetJson`.

- [x] **Step 1: Failing tests:** `fleet <localdir>` prints the table and exits 0 when no errors / 1 when any repo has errors; `--json` emits parseable schemaVersion-2 JSON; progress lines stream to stderr; `fleet` without target → exit 2 + usage; `--concurrency` rejects non-positive/non-numeric values; fleet-only flags rejected for `scan`/`check`; existing single-repo behavior unchanged (whole suite still green).

- [x] **Step 2: Implement; build + full `npm test` → PASS; commit**

### Task 8: Docs + version bump

**Files:**
- Modify: `README.md` ("Fleet scanning" section after single-repo docs: command, example table output, one-line health grade explanations, read-only note + Phase 3 roadmap link), `package.json` (version 0.5.0)
- Create: `.github/PHASE3_ISSUE.md` (issue text titled "Multi-repo config sync (Phase 3) — tell us how your team would use this")

- [x] **Steps: write docs → `npm run build && npm test` PASS → commit**

### Task 9: Real-world verification across numerous repos

- [x] Run built CLI: `node dist/cli.js fleet gh:<moderate real org>` — table renders, grades sane.
- [x] `--json` output on the same org parses and matches schema.
- [x] File-list target with mixed `owner/repo` + full URLs + one bogus repo (failure isolation).
- [x] Local-directory target on a folder of cloned repos.
- [x] Verify rate-limit / not-found error paths against the real API (bogus org name).
- [x] Record results for the final summary; do not publish.
