import type { DatabasePreferences } from '@vacuumshift/shared';

export interface BloatCollectionThresholds {
  minTableBytes: number;
  minIndexBytes: number;
  excludePatterns: string[];
}

export function thresholdsFromPreferences(prefs: DatabasePreferences): BloatCollectionThresholds {
  return {
    minTableBytes: prefs.minTableSizeMb * 1024 * 1024,
    minIndexBytes: prefs.minIndexSizeMb * 1024 * 1024,
    excludePatterns: prefs.excludePatterns ?? [],
  };
}
