import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';
import { makeRepo, type FixtureRepo } from './helpers.js';

const fixtures: FixtureRepo[] = [];
function track(repo: FixtureRepo): FixtureRepo {
  fixtures.push(repo);
  return repo;
}
afterAll(() => fixtures.forEach((f) => f.cleanup()));

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const repo = track(makeRepo({}));
    const config = loadConfig(repo.root);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.rules['oversized']).toMatchObject({
      enabled: true,
      warnLines: 100,
      errorLines: 200,
      warnBytes: 10240,
    });
  });

  it('merges threshold overrides from .agentlint.json', () => {
    const repo = track(
      makeRepo({
        '.agentlint.json': JSON.stringify({ rules: { oversized: { warnLines: 50 } } }),
      }),
    );
    const config = loadConfig(repo.root);
    expect(config.rules['oversized']).toMatchObject({
      enabled: true,
      warnLines: 50,
      errorLines: 200,
    });
    expect(config.rules['staleness'].enabled).toBe(true);
  });

  it('treats severity "off" as disabled', () => {
    const repo = track(
      makeRepo({
        '.agentlint.json': JSON.stringify({ rules: { staleness: { severity: 'off' } } }),
      }),
    );
    expect(loadConfig(repo.root).rules['staleness'].enabled).toBe(false);
  });

  it('rejects unknown rule names', () => {
    const repo = track(
      makeRepo({ '.agentlint.json': JSON.stringify({ rules: { bogus: {} } }) }),
    );
    expect(() => loadConfig(repo.root)).toThrow(/unknown rule "bogus"/i);
  });

  it('rejects malformed JSON with a clear error', () => {
    const repo = track(makeRepo({ '.agentlint.json': '{not json' }));
    expect(() => loadConfig(repo.root)).toThrow(/\.agentlint\.json/);
  });

  it('narrows to an explicit rule list', () => {
    const repo = track(makeRepo({}));
    const config = loadConfig(repo.root, { rules: ['oversized', 'broken-refs'] });
    expect(config.rules['oversized'].enabled).toBe(true);
    expect(config.rules['broken-refs'].enabled).toBe(true);
    expect(config.rules['staleness'].enabled).toBe(false);
    expect(config.rules['contradictions'].enabled).toBe(false);
  });

  it('rejects unknown rules in the explicit list', () => {
    const repo = track(makeRepo({}));
    expect(() => loadConfig(repo.root, { rules: ['nope'] })).toThrow(/unknown rule "nope"/i);
  });

  it('loads from an explicit config path', () => {
    const repo = track(
      makeRepo({
        'custom.json': JSON.stringify({ rules: { oversized: { enabled: false } } }),
      }),
    );
    const config = loadConfig(repo.root, { configPath: 'custom.json' });
    expect(config.rules['oversized'].enabled).toBe(false);
  });
});
