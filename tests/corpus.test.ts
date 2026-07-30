import { afterAll, describe, expect, it } from 'vitest';
import { brokenRefs } from '../src/rules/broken-refs.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

/**
 * Shapes taken from public repos, verbatim: the doc line as it ships upstream,
 * plus the neighbouring repo files that decide the verdict. Synthetic fixtures
 * kept passing while real repos produced 16 false positives out of 37 findings,
 * because invented paths never reproduce a sibling monorepo or a docs-site
 * route. Every case here was checked against the upstream repo by hand.
 *
 * Network calls are banned in this suite (see CONTRIBUTING.md), so cases are
 * transcribed rather than cloned. When adding one, record the upstream path and
 * the commit-independent fact that makes the expectation true — not just a count.
 */
interface CorpusCase {
  /** Repo the shape came from, plus what it exercises. */
  name: string;
  /** Why the expectation holds, independent of any commit. */
  because: string;
  files: Record<string, string>;
  /** Substrings expected in the findings, one per finding. Empty = clean. */
  expect: string[];
}

const CASES: CorpusCase[] = [
  {
    name: 'openai/codex — AGENTS.md names a renamed crate module',
    because: 'codex-mcp/src/ has connection_manager.rs; the mcp_ prefix is gone',
    files: {
      'AGENTS.md':
        'When working with MCP tool calls, prefer using `codex-rs/codex-mcp/src/mcp_connection_manager.rs` to handle mutation of tools and tool calls.\n',
      'codex-rs/codex-mcp/src/connection_manager.rs': '// rust',
      'codex-rs/codex-mcp/src/lib.rs': '// rust',
    },
    expect: ['mcp_connection_manager.rs'],
  },
  {
    name: 'microsoft/playwright — skill links a sibling skill that lives elsewhere',
    because: 'playwright-cli ships under packages/playwright-core/src/tools/skills/',
    files: {
      '.claude/skills/playwright-triage/SKILL.md':
        'To step through a test interactively, use the [playwright-cli](../playwright-cli/SKILL.md) skill.\n',
      '.claude/skills/playwright-dev/SKILL.md': '# dev\n',
      'packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md': '# cli\n',
    },
    expect: ['playwright-cli/SKILL.md'],
  },
  {
    name: 'cloudflare/workers-sdk — package AGENTS.md names an absent build script',
    because: 'no bundle.mjs exists at the package root or the repo root',
    files: {
      'packages/vitest-pool-workers/AGENTS.md': 'The bundle is built by `scripts/bundle.mjs`.\n',
      'packages/vitest-pool-workers/scripts/build.mjs': '// build',
      'packages/vitest-pool-workers/src/index.ts': 'export {}\n',
    },
    expect: ['scripts/bundle.mjs'],
  },
  {
    name: 'n8n-io/n8n — skill names a store that moved in the frontend restructure',
    because: 'editor-ui keeps rbac helpers under app/utils/rbac/, not app/stores/',
    files: {
      '.agents/skills/protect-endpoints/SKILL.md':
        'Scopes come from `packages/frontend/editor-ui/src/app/stores/rbac.store.ts`.\n',
      'packages/frontend/editor-ui/src/app/utils/rbac/checks/hasScope.ts': 'export {}\n',
      'packages/frontend/editor-ui/src/app/init.ts': 'export {}\n',
    },
    expect: ['rbac.store.ts'],
  },
  {
    name: 'PostHog/posthog — skill maps a sibling repo tree (PostHog/code)',
    because: 'this repo ships only packages/quill; ui, core, shared live in PostHog/code',
    files: {
      '.agents/skills/adding-inbox-sources/SKILL.md':
        'The app renders it via `packages/ui/src/features/inbox/components/DynamicSourceSetup.tsx`.\n' +
        '1. `packages/shared/src/inbox-types.ts` — add the source to the union.\n' +
        '2. `packages/api-client/src/posthog-client.ts` — extend the config union.\n' +
        '3. `packages/core/src/inbox/signalSourceService.ts` — register the service.\n' +
        '4. `packages/host-router/src/routers/integration.router.ts` — route it.\n',
      'packages/quill/src/index.ts': 'export {}\n',
    },
    expect: [],
  },
  {
    name: 'PostHog/posthog — skill cites posthog-js by name',
    because: 'the prose attributes each path to posthog-js / posthog-react-native',
    files: {
      '.agents/skills/survey-sdk-audit/SKILL.md':
        'See posthog-js browser: `packages/browser/src/extensions/surveys.ts`\n' +
        'For mobile-specific patterns, see posthog-react-native: `packages/react-native/src/surveys/getActiveMatchingSurveys.ts`\n',
      'packages/quill/src/index.ts': 'export {}\n',
    },
    expect: [],
  },
  {
    name: 'PostHog/posthog — AGENTS.md names a module that moved within the repo',
    because: 'personhog sits under nodejs/src/common/, not nodejs/src/ingestion/',
    files: {
      'proto/AGENTS.md': 'The client lives at `nodejs/src/ingestion/personhog/client.ts`.\n',
      'nodejs/src/common/personhog/personhog-client-component.ts': 'export {}\n',
      'nodejs/src/common/personhog/client.ts': 'export {}\n',
      'nodejs/src/index.ts': 'export {}\n',
    },
    expect: ['nodejs/src/ingestion/personhog/client.ts'],
  },
  {
    name: 'vercel/next.js — skill links a rendered docs route',
    because: 'docs sources are numbered on disk (docs/01-app/), so /docs/app/* is a URL',
    files: {
      '.agents/skills/insight-error-page/SKILL.md':
        'Link readers to the [glossary](/docs/app/glossary) for terminology.\n',
      'docs/01-app/index.mdx': '# App Router\n',
      'docs/02-pages/index.mdx': '# Pages Router\n',
    },
    expect: [],
  },
  {
    name: 'kortix-ai/suna — AGENTS.md names a renamed feature directory',
    because: 'the co-worker feature became workspace; the file itself still exists',
    files: {
      'AGENTS.md':
        'Use recent product surfaces as references before editing:\n' +
        '`apps/web/src/features/co-worker/project-layout/project-home.tsx`.\n',
      'apps/web/src/features/workspace/project-layout/project-home.tsx': 'export {}\n',
      'apps/web/src/features/workspace/project-layout/project-shell.tsx': 'export {}\n',
    },
    expect: ['co-worker'],
  },
];

const fixtures: FixtureRepo[] = [];
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('broken-refs against real-repo shapes', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const repo = makeRepo(testCase.files);
      fixtures.push(repo);
      const findings = brokenRefs.check(makeCtx(repo.root));
      const messages = findings.map((f) => f.message);
      // Report the surprise, not just a count: a corpus regression is only
      // actionable if the failure says which path changed verdict.
      expect(messages, testCase.because).toHaveLength(testCase.expect.length);
      testCase.expect.forEach((needle, i) => expect(messages[i]).toContain(needle));
    });
  }
});
