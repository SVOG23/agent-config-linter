# PROJECT BRIEF — Agent Config Linter (Phase 1)

## What we're building
A CLI tool (run via `npx`) that scans a repo for AI agent config files, lints them, and reports problems. This is Phase 1 of a larger product ("Renovate for agent configs"). The later multi-repo product will NOT diff whole files against a master — config files are legitimately unique per project. It will sync **tagged shared blocks** (org-wide standards between markers like `<!-- org:standards:begin -->` / `<!-- org:standards:end -->`) across repos while leaving project-specific content untouched, like Renovate updates dependencies inside a unique package.json. Do NOT build any multi-repo features yet — this context is only so Phase 1 design decisions don't block it.

## The problem
Developers using Claude Code, Codex, Cursor, and Copilot write instruction files (CLAUDE.md, AGENTS.md, .cursorrules, .claude/skills/, MCP configs like .mcp.json). These files go stale and inconsistent, which measurably degrades agent performance. No tool checks them.

## Phase 1 scope (build ONLY this)
Two commands:

1. `scan` — walk the repo, find every agent config file:
   - CLAUDE.md (root + nested), AGENTS.md, .cursorrules, .cursor/rules/
   - .claude/skills/**/SKILL.md, .claude/settings.json, .claude/commands/
   - .mcp.json / mcp config files
   - .github/copilot-instructions.md
   - Output: inventory list with file path, size, last-modified date.

2. `check` — lint the found files and report findings with severity (error/warn/info):
   - **Staleness:** config last modified N days ago vs. recent repo commit activity (use git log). Flag if repo is active but config is old (default: >90 days + >100 commits since).
   - **Missing:** active repo (has commits, has code) but no agent config at all.
   - **Oversized:** instruction files past thresholds where models start dropping rules (default: warn >100 lines, error >200 lines; also warn >10KB).
   - **Contradictions (basic):** duplicate/conflicting instructions across files in the same repo (e.g., two files both claim to define commit conventions) — string/heuristic level, no LLM calls in v1.
   - **Broken references:** instructions referencing files/scripts/commands that don't exist in the repo.
   - **Wrong-level content (heuristic):** personal-preference patterns in committed project files (e.g., "I prefer...", references to a specific user's machine/editor/paths like /Users/<name>) — these belong in the user-level ~/.claude/CLAUDE.md, not in git. The config hierarchy (user -> project -> directory) is widely misunderstood; this rule catches leakage between levels.
   - **Eager full-file embeds:** `@`-imports that embed entire large docs into every session (e.g., @docs/big-guide.md) — flag when the referenced file is large; suggest conditional phrasing instead.

Output: clean human-readable terminal output (colors, grouped by file) + `--json` flag for CI. Exit code non-zero if any errors (so it works as a CI gate).

## Tech constraints
- Node.js + TypeScript, single package, published to npm, runnable as `npx <name>`
- Zero config required to run; optional config file (`.agentlint.json` or similar) to tune thresholds
- No network calls, no telemetry, no LLM API calls in v1 — pure static analysis + git
- Fast: must complete on a large repo in seconds
- Test coverage on all lint rules — this tool's credibility depends on not being wrong
- Never modify user files in Phase 1 (read-only)

## Code quality rules
- Small modules: one lint rule per file, shared scanner core
- Rules must be individually toggleable
- Prioritize few, high-confidence rules over many noisy ones (false positives kill linters)
- Keep dependencies minimal

## Explicitly out of scope (do not build)
- Multi-repo / GitHub org scanning
- Auto-fix or PR creation
- Hosted dashboard, auth, database
- LLM-powered analysis
- Security scanning (Snyk etc. own that)

## Definition of done for Phase 1
- `npx <name> check` runs on any repo and produces useful findings
- Works on 20 real-world open-source repos without crashing
- README with install, usage, rule list, and JSON output docs
- MIT license
