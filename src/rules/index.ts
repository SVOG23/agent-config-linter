import type { Rule } from '../types.js';
import { brokenRefs } from './broken-refs.js';
import { contradictions } from './contradictions.js';
import { eagerEmbeds } from './eager-embeds.js';
import { missingConfig } from './missing-config.js';
import { oversized } from './oversized.js';
import { staleness } from './staleness.js';
import { wrongLevel } from './wrong-level.js';

export const ALL_RULES: readonly Rule[] = [
  missingConfig,
  staleness,
  oversized,
  brokenRefs,
  eagerEmbeds,
  wrongLevel,
  contradictions,
];
