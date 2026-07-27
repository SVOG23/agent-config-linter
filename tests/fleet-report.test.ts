import { describe, expect, it } from 'vitest';
import { colorize } from '../src/colors.js';
import { renderFleetJson } from '../src/report/json.js';
import { renderFleetText } from '../src/report/terminal.js';
import type { Finding, FleetResult } from '../src/types.js';

const c = colorize(false);

const finding = (severity: Finding['severity'], message: string): Finding => ({
  rule: 'broken-refs',
  severity,
  file: 'CLAUDE.md',
  line: 1,
  message,
});

const RESULT: FleetResult = {
  target: 'gh:acme',
  repos: [
    {
      repo: 'acme/api',
      health: 'C',
      summary: { errors: 2, warnings: 1, infos: 0 },
      findings: [
        finding('error', 'Reference to missing file docs/a.md'),
        finding('error', 'Reference to missing file docs/b.md'),
        finding('warn', 'Personal preference in shared config'),
      ],
      configCount: 3,
    },
    {
      repo: 'acme/clean',
      health: 'A',
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
      configCount: 1,
    },
    {
      repo: 'acme/bare',
      health: null,
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
      configCount: 0,
    },
    { repo: 'acme/broken', error: 'clone failed: repository not found' },
  ],
  totals: { repos: 4, withConfigs: 2, withFindings: 1, errors: 2, warnings: 1 },
};

describe('renderFleetText', () => {
  const text = renderFleetText(RESULT, c);

  it('renders one table row per scanned repo with the header columns', () => {
    expect(text).toMatch(/Repo\s+Configs\s+Errors\s+Warnings\s+Health/);
    expect(text).toMatch(/acme\/api\s+3\s+2\s+1\s+C/);
    expect(text).toMatch(/acme\/clean\s+1\s+0\s+0\s+A/);
  });

  it('shows an em dash for repos with no agent configs', () => {
    expect(text).toMatch(/acme\/bare\s+0\s+0\s+0\s+—/);
  });

  it('prints fleet totals', () => {
    expect(text).toContain('4 repos scanned, 2 have agent configs, 1 has findings');
    expect(text).toContain('2 errors, 1 warning');
  });

  it('lists worst offenders with their top finding', () => {
    expect(text).toMatch(/worst offenders/i);
    expect(text).toContain('acme/api');
    expect(text).toContain('Reference to missing file docs/a.md');
  });

  it('lists failed repos with the reason', () => {
    expect(text).toMatch(/failed to scan/i);
    expect(text).toContain('acme/broken');
    expect(text).toContain('clone failed: repository not found');
  });

  it('omits worst offenders when no repo has errors', () => {
    const clean: FleetResult = {
      target: 'gh:acme',
      repos: [RESULT.repos[1]!],
      totals: { repos: 1, withConfigs: 1, withFindings: 0, errors: 0, warnings: 0 },
    };
    expect(renderFleetText(clean, c)).not.toMatch(/worst offenders/i);
  });
});

describe('renderFleetJson', () => {
  const parsed = JSON.parse(renderFleetJson(RESULT));

  it('emits schemaVersion 2 fleet output', () => {
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.fleet).toBe(true);
    expect(parsed.target).toBe('gh:acme');
    expect(parsed.totals).toEqual(RESULT.totals);
  });

  it('shapes scanned repos like the brief', () => {
    expect(parsed.repos[0]).toEqual({
      repo: 'acme/api',
      health: 'C',
      summary: { errors: 2, warnings: 1, infos: 0 },
      findings: [
        {
          rule: 'broken-refs',
          severity: 'error',
          file: 'CLAUDE.md',
          line: 1,
          message: 'Reference to missing file docs/a.md',
        },
        {
          rule: 'broken-refs',
          severity: 'error',
          file: 'CLAUDE.md',
          line: 1,
          message: 'Reference to missing file docs/b.md',
        },
        {
          rule: 'broken-refs',
          severity: 'warn',
          file: 'CLAUDE.md',
          line: 1,
          message: 'Personal preference in shared config',
        },
      ],
    });
  });

  it('shapes failed repos as health null plus error', () => {
    expect(parsed.repos[3]).toEqual({
      repo: 'acme/broken',
      health: null,
      error: 'clone failed: repository not found',
    });
  });
});
