import type { CheckSummary, HealthGrade } from '../types.js';

export function healthGrade(summary: CheckSummary, configCount: number): HealthGrade {
  if (configCount === 0) return null;
  if (summary.errors >= 3) return 'D';
  if (summary.errors >= 1) return 'C';
  if (summary.warnings > 0 || summary.infos > 0) return 'B';
  return 'A';
}
