import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Worktrees under .claude/ hold full checkouts, so their tests/ collect as a
    // second copy of this suite — an older revision voting on green.
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
    // Fixtures shell out to git per commit; Windows runners spawn processes
    // ~10x slower than POSIX, so commit-heavy fixtures blow the 5s default.
    testTimeout: 60_000,
  },
});
