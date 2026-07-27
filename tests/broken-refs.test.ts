import { afterAll, describe, expect, it } from 'vitest';
import { brokenRefs } from '../src/rules/broken-refs.js';
import { extractRefs } from '../src/rules/refs.js';
import { makeRepo, type FixtureRepo } from './helpers.js';
import { makeCtx } from './rulehelpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('extractRefs', () => {
  it('extracts @-imports with line numbers', () => {
    const refs = extractRefs('# Title\n\nSee @docs/guide.md for details\n@README.md\n');
    expect(refs).toContainEqual({ kind: 'at-import', value: 'docs/guide.md', line: 3 });
    expect(refs).toContainEqual({ kind: 'at-import', value: 'README.md', line: 4 });
  });

  it('ignores emails, handles, and npm scopes', () => {
    const refs = extractRefs(
      'Contact dev@example.com or @octocat\nUse @types/node and @scope/pkg\n',
    );
    expect(refs.filter((r) => r.kind === 'at-import')).toHaveLength(0);
  });

  it('extracts relative markdown links but not urls or anchors', () => {
    const refs = extractRefs(
      '[guide](docs/guide.md) [site](https://x.com) [top](#top) [mail](mailto:a@b.c)\n[sub](./sub/file.md#section)\n',
    );
    const links = refs.filter((r) => r.kind === 'md-link').map((r) => r.value);
    expect(links).toEqual(['docs/guide.md', './sub/file.md']);
  });

  it('extracts path-like backtick tokens, skipping globs and placeholders', () => {
    const refs = extractRefs(
      'Run `scripts/deploy.sh` then `src/**/*.ts` and `<path/to/file.md>` and `x.py`\nAlso `docs/setup.md`.\n',
    );
    const tokens = refs.filter((r) => r.kind === 'path-token').map((r) => r.value);
    expect(tokens).toEqual(['scripts/deploy.sh', 'docs/setup.md']);
  });

  it('extracts npm run scripts', () => {
    const refs = extractRefs('Run `npm run build:prod` and pnpm run lint before pushing\n');
    const scripts = refs.filter((r) => r.kind === 'npm-script').map((r) => r.value);
    expect(scripts).toEqual(['build:prod', 'lint']);
  });

  it('does not extract @-imports or md-links from code spans or fenced blocks', () => {
    const refs = extractRefs(
      'Example: `> @tests/auth.test.ts fix this` and `[label](docs/fake.md)` syntax\n```\n@docs/example.md\n[x](docs/gone.md)\n```\nReal @docs/real.md\n',
    );
    expect(refs.filter((r) => r.kind === 'at-import').map((r) => r.value)).toEqual([
      'docs/real.md',
    ]);
    expect(refs.filter((r) => r.kind === 'md-link')).toHaveLength(0);
  });

  it('still extracts npm scripts and backtick paths inside fenced blocks', () => {
    const refs = extractRefs('```bash\nnpm run deploy\ncat `scripts/setup.sh`\n```\n');
    expect(refs.filter((r) => r.kind === 'npm-script').map((r) => r.value)).toEqual(['deploy']);
    expect(refs.filter((r) => r.kind === 'path-token').map((r) => r.value)).toEqual([
      'scripts/setup.sh',
    ]);
  });

  it('extracts bun run and yarn run scripts', () => {
    const refs = extractRefs('Use `bun run typecheck` or yarn run lint\n');
    expect(refs.filter((r) => r.kind === 'npm-script').map((r) => r.value)).toEqual([
      'typecheck',
      'lint',
    ]);
  });

  it('strips sentence punctuation from script names but keeps prefix colons', () => {
    const refs = extractRefs('First npm run build. Then use npm run watch:* modes\n');
    expect(refs.filter((r) => r.kind === 'npm-script').map((r) => r.value)).toEqual([
      'build',
      'watch:',
    ]);
  });

  it('skips flags after run and ellipsis pseudo-paths', () => {
    const refs = extractRefs(
      'Use `pnpm run --filter app build`\nEdit `webview-ui/.../utils.ts` as needed\n',
    );
    expect(refs.filter((r) => r.kind === 'npm-script')).toHaveLength(0);
    expect(refs.filter((r) => r.kind === 'path-token')).toHaveLength(0);
  });
});

describe('broken-refs', () => {
  it('errors on @-imports pointing nowhere', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Read @docs/missing.md first\n' }));
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'broken-refs',
      severity: 'error',
      file: 'CLAUDE.md',
      line: 1,
    });
    expect(findings[0].message).toContain('docs/missing.md');
  });

  it('accepts refs that exist (root- or file-relative)', () => {
    const repo = track(
      makeRepo({
        'packages/api/CLAUDE.md': 'See @docs/api.md and [root doc](README.md)\n',
        'packages/api/docs/api.md': '# api',
        'README.md': '# root',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('errors on broken markdown links and backtick paths', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': '[setup](docs/setup.md)\nRun `scripts/gone.sh`\n',
        'scripts/other.sh': '#!/bin/sh',
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.line)).toEqual([1, 2]);
  });

  it('forgives paths that exist deeper in the monorepo (context-relative prose)', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'The dev server lives in `src/cli/dev.ts`\n',
        'packages/next/src/cli/dev.ts': 'code',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips unanchored tokens like repo slugs and package specifiers', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'PRs belong to `vercel/next.js` and use `react-dom/server.edge`\n',
        'src/app.ts': 'code',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('still flags anchored missing paths', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'Start with `src/gone.ts`\n',
        'src/app.ts': 'code',
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('src/gone.ts');
  });

  it('skips references into build-output directories', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'Bundling produces `dist/extension.js`\n',
        'src/app.ts': 'code',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips mentions of agent-config locations and local-only files', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md':
          'Settings order:\n- `.claude/settings.json` (project)\n- `.continue/settings.local.json` (local)\n- `.claude/CLAUDE.md`\n',
        '.claude/skills/x/SKILL.md': '# skill',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips references hedged with "if exists"', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'Read `docs/EXTRA.md` (if exists) before starting\n',
        'docs/other.md': '# other',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('accepts npm scripts defined in any workspace package.json', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'Run `npm run build` then `npm run nowhere`\n',
        'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
        'packages/app/package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('nowhere');
  });

  it('checks npm scripts against root package.json', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Run `npm run test` and `npm run nope`\n',
        'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('nope');
  });

  it('skips npm script checks when there is no package.json', () => {
    const repo = track(makeRepo({ 'CLAUDE.md': 'Run `npm run anything`\n' }));
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('accepts trailing-colon mentions when a script family matches the prefix', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Use `npm run watch:*` for the various watch modes\n',
        'package.json': JSON.stringify({ scripts: { 'watch:esbuild': 'x', 'watch:tsc': 'y' } }),
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('flags prefix mentions with no matching script family', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Use `npm run gone:*` tasks\n',
        'package.json': JSON.stringify({ scripts: { build: 'x' } }),
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('gone:');
  });

  it('forgives setup-time env files that are created locally', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Set vars in `frontend/.env` or `frontend/.env.production`\n',
        'frontend/app.ts': 'code',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('does not flag @-imports shown inside fenced example blocks', () => {
    const repo = track(
      makeRepo({ 'CLAUDE.md': 'Import syntax:\n```\n@docs/missing.md\n```\n' }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('checks bun run scripts against package.json', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Run `bun run typecheck` or `bun run missing`\n',
        'package.json': JSON.stringify({ scripts: { typecheck: 'tsc' } }),
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('missing');
  });

  it('suggests a near-miss when the missing file exists under another extension or directory', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Actions live in `src/types/action-type.ts`\n',
        'src/types/action-type.tsx': 'code',
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].suggestion).toContain('src/types/action-type.tsx');
  });

  it('omits the near-miss suggestion when the name is too common', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'See `src/gone/index.ts`\n',
        'src/a/index.ts': 'x',
        'src/b/index.ts': 'x',
        'src/c/index.ts': 'x',
        'src/d/index.ts': 'x',
      }),
    );
    const findings = brokenRefs.check(makeCtx(repo.root));
    expect(findings).toHaveLength(1);
    expect(findings[0].suggestion).not.toContain('index.ts');
  });

  it('parses angle-bracket markdown link destinations', () => {
    const refs = extractRefs('[Workflows](<docs/my dir/workflows.md>) and [x](<docs/plain.md>)\n');
    expect(refs.filter((r) => r.kind === 'md-link').map((r) => r.value)).toEqual([
      'docs/my dir/workflows.md',
      'docs/plain.md',
    ]);
  });

  it('skips single-letter script placeholders like `bun run X`', () => {
    const repo = track(
      makeRepo({
        'CLAUDE.md': 'Emit `bun run X` commands, never npx\n',
        'package.json': JSON.stringify({ scripts: { build: 'x' } }),
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips GitHub web paths like ../blob/master/CONTRIBUTING.md', () => {
    const repo = track(
      makeRepo({
        'packages/tools/AGENTS.md':
          'Per our [contributing guide](../blob/master/CONTRIBUTING.md), thanks!\n',
        'src/app.ts': 'x',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips refs on lines that forbid creating the file', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': "Don't propose `src/skills/INDEX.md` or prefix renames\n",
        'src/app.ts': 'x',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips extended placeholder shapes (my*/xxx* names, date templates, file_name)', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md':
          'Add `src/shell/mycommand.go`\nCreate `src/services/xxxService.ts`\nWrite `docs/changelog/YYYY-MM-DD-topic.mdx`\nSee `src/migrations/0046_meaningless_file_name.sql`\n',
        'src/app.ts': 'x',
        'docs/index.md': 'x',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips placeholder paths that were never real claims', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md':
          'Name tests like `tests/test_action_EventNameHere.py`\nCreate `src/features/xxx/xxx.feature`\nUse extensions like `./foo.ts` or `./bar.tsx`\n',
        'tests/real_test.py': 'x',
        'src/app.ts': 'x',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('forgives absent paths that match gitignore rules (build output)', () => {
    const repo = track(
      makeRepo(
        {},
        {
          commits: [
            {
              files: {
                '.gitignore': 'packages/client/runtime/\n*.bundle.js\n',
                'CLAUDE.md':
                  'Generated clients import `packages/client/runtime/client.js`\nBundles land at [bundle](build-out/app.bundle.js)\n',
                'packages/client/src/app.ts': 'x',
              },
              daysAgo: 1,
            },
          ],
        },
      ),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('skips references hedged with "unless ... already exists"', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md': 'Do not create `./utils/index.ts` unless the file already exists\n',
        'src/app.ts': 'x',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('hedge detection tolerates dots in the hedged path', () => {
    const repo = track(
      makeRepo({
        'AGENTS.md':
          "- **Avoid creating barrel files** (`index.ts` that re-export from other modules). Import directly from the source file (e.g., `import { foo } from './utils/query-utils'` not `import { foo } from './utils'`), unless `./utils/index.ts` file already exists.\n",
        'src/app.ts': 'x',
      }),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });

  it('does not flag files that exist on disk but are gitignored', () => {
    const repo = track(
      makeRepo(
        { 'local/notes.md': 'secret' },
        { commits: [{ files: { '.gitignore': 'local/\n', 'CLAUDE.md': 'See @local/notes.md\n' }, daysAgo: 1 }] },
      ),
    );
    expect(brokenRefs.check(makeCtx(repo.root))).toHaveLength(0);
  });
});
