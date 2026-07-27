import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Fixtures shell out to git per commit; Windows runners spawn processes
    // ~10x slower than POSIX, so commit-heavy fixtures blow the 5s default.
    testTimeout: 60_000,
  },
});
