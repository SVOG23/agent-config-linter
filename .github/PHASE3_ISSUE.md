# Multi-repo config sync (Phase 3) — tell us how your team would use this

`unrot fleet` (shipped in 0.5.0) tells you which repos have rotten agent configs. The obvious next step is helping you *fix* the rot fleet-wide: keeping shared config content in sync across many repos instead of hand-editing 30 copies of CLAUDE.md.

Rough shape we're considering:

- Mark shared sections of a config with tagged blocks, with one repo (or a template repo) as the source of truth.
- `unrot sync --check` reports which repos have drifted from the source blocks (CI-friendly, read-only).
- `unrot sync` opens PRs — never direct pushes — that update drifted blocks, leaving repo-specific content untouched.

Before we build it, we'd like to hear how (or whether) your team would actually use this:

1. How many repos are you maintaining agent configs across today, and how do you keep them consistent now?
2. What content do you share verbatim (tooling conventions, commit rules, security guidance…) vs. keep repo-specific?
3. Would you want opt-in per repo, per file, or per block?
4. Is PR-per-repo the right delivery, or would you rather get one summary and apply changes yourself?
5. Anything that would make you *not* adopt a sync tool (review overhead, bot PRs, merge conflicts…)?

Comment below — even a two-line answer helps us prioritize. 🙏

*Phase 2 (`unrot fleet`) is strictly read-only; nothing in Phase 3 will ever write to your repos without an explicit opt-in and a reviewable PR.*
