import { describe, expect, it } from 'vitest';
import { healthGrade } from '../src/fleet/health.js';

const summary = (errors = 0, warnings = 0, infos = 0) => ({ errors, warnings, infos });

describe('healthGrade', () => {
  it('grades null when the repo has no agent configs', () => {
    expect(healthGrade(summary(), 0)).toBeNull();
    expect(healthGrade(summary(1), 0)).toBeNull();
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
    expect(healthGrade(summary(7, 2, 1), 4)).toBe('D');
  });
});
