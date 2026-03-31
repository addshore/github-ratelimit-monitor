import type { DataPoint, StoredResourceData } from './types';

interface DemoResource {
  limit: number;
  remaining: number;
  drainPerTick: number;
  resetIntervalMs: number;
  lastReset: number;
}

const DEMO_RESOURCE_CONFIGS: Record<string, Omit<DemoResource, 'remaining' | 'lastReset'>> = {
  core:                        { limit: 5000,  drainPerTick: 25, resetIntervalMs: 300_000 },
  search:                      { limit: 30,    drainPerTick: 2,  resetIntervalMs: 60_000  },
  graphql:                     { limit: 5000,  drainPerTick: 40, resetIntervalMs: 300_000 },
  code_search:                 { limit: 10,    drainPerTick: 1,  resetIntervalMs: 60_000  },
  integration_manifest:        { limit: 5000,  drainPerTick: 5,  resetIntervalMs: 300_000 },
  actions_runner_registration: { limit: 10000, drainPerTick: 10, resetIntervalMs: 300_000 },
  scim:                        { limit: 15000, drainPerTick: 8,  resetIntervalMs: 300_000 },
  dependency_snapshots:        { limit: 100,   drainPerTick: 3,  resetIntervalMs: 60_000  },
};

export class DemoGenerator {
  private resources: Map<string, DemoResource>;

  constructor() {
    const now = Date.now();
    this.resources = new Map();
    for (const [name, cfg] of Object.entries(DEMO_RESOURCE_CONFIGS)) {
      this.resources.set(name, {
        ...cfg,
        remaining: cfg.limit - Math.floor(Math.random() * cfg.limit * 0.3),
        lastReset: now - Math.floor(Math.random() * cfg.resetIntervalMs),
      });
    }
  }

  /** Generate one new data point (advances internal state). */
  generate(): DataPoint {
    return this.tick(Date.now());
  }

  /** Generate `count` historical points leading up to now. */
  generateHistory(count: number, intervalMs: number): DataPoint[] {
    const now = Date.now();
    const startTime = now - count * intervalMs;

    // Reset state to the start of the history window
    for (const [, res] of this.resources) {
      res.lastReset = startTime - Math.floor(Math.random() * res.resetIntervalMs);
      res.remaining = res.limit - Math.floor(Math.random() * res.limit * 0.1);
    }

    const points: DataPoint[] = [];
    for (let i = 0; i < count; i++) {
      points.push(this.tick(startTime + i * intervalMs));
    }
    return points;
  }

  private tick(timestamp: number): DataPoint {
    const resources: Record<string, StoredResourceData> = {};

    for (const [name, res] of this.resources) {
      // Reset when window expires
      if (timestamp - res.lastReset >= res.resetIntervalMs) {
        res.remaining = res.limit;
        res.lastReset = timestamp;
      }

      // Drain with some randomness
      const drain = Math.floor(Math.random() * res.drainPerTick * 2);
      res.remaining = Math.max(0, res.remaining - drain);

      resources[name] = {
        remaining: res.remaining,
        limit: res.limit,
        used: res.limit - res.remaining,
        reset: Math.floor((res.lastReset + res.resetIntervalMs) / 1000),
      };
    }

    return { timestamp, resources };
  }
}
