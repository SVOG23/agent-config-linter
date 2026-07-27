# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. These bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Verification runs through type-checking and unit tests:
- Before declaring a task done, run `npm run build` and `npm test` and read the output. Never claim "done", "fixed", or "passing" for a check you haven't run in this session — a claim without fresh evidence is a guess.
- Transform vague tasks into verifiable goals. "Add validation" → "define the invalid inputs, handle each, confirm the types check and tests pass." "Fix the bug" → "reproduce it, fix it, confirm the fix and that nothing else regresses."

For multi-step tasks, state a brief plan with a verification check per step:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

### 5. Read Before You Write

**Never edit code you haven't read. Evidence beats assumption.**

- Read the target file (and its callers) before editing — the whole relevant section, not just the grep hit.
- Changing a shared function or type? Grep every usage first and state the blast radius before touching anything.
- Debugging: reproduce the failure first, trace to the root cause, then fix the cause — not the symptom. If a fix doesn't work, question the diagnosis; don't stack a second guess on top of the first.
- If mid-task evidence contradicts your plan, an assumption, or these docs, stop and reconcile before continuing.

### 6. Report Honestly

- Lead with the outcome — what happened or what you found — then supporting detail.
- If a test fails, a step was skipped, or results are partial, say so plainly and show the output. A truthful failure beats a hopeful success.
- Write code comments only for constraints the code can't express — never to narrate the change or justify it to the reviewer.
