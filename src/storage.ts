import type { DataPoint, StoredResourceData } from './types';

const DATA_KEY = 'rate_limit_data';
// ~7MB in chars — leaves headroom under typical 10MB browser localStorage quota.
// With the compact format each point is stored as a number array (not repeated field names),
// giving roughly 10-15× compression vs the old per-point JSON objects.
const MAX_STORAGE_CHARS = 7 * 1024 * 1024;

// ---- Compact storage format v2 ----
// Instead of storing each DataPoint as a full JSON object (repeated field names every row),
// we store a columnar structure:
//   keys: string[]       — resource names, fixed order
//   lims: number[]       — latest known limit per resource
//   rsts: number[]       — latest known reset (Unix seconds) per resource
//   pts:  number[][]     — each row: [timestamp_ms, remaining_0, remaining_1, …]
//                          missing resource → -1 sentinel
// used = limit − remaining is derived on read; it is never stored.
interface CompactStore {
  v: 2;
  keys: string[];
  lims: number[];
  rsts: number[];
  pts: number[][];
}

function encodeCompact(data: DataPoint[]): CompactStore {
  // Collect all resource names (sorted for determinism)
  const keySet = new Set<string>();
  for (const pt of data) {
    for (const k of Object.keys(pt.resources)) keySet.add(k);
  }
  const keys = Array.from(keySet).sort();
  const n = keys.length;

  // Derive latest limits and reset times (scan forward so last write wins)
  const lims: number[] = new Array(n).fill(0);
  const rsts: number[] = new Array(n).fill(0);
  for (const pt of data) {
    for (let i = 0; i < n; i++) {
      const res = pt.resources[keys[i]];
      if (res) {
        lims[i] = res.limit;
        rsts[i] = res.reset ?? 0;
      }
    }
  }

  // Encode points as flat number arrays
  const pts: number[][] = data.map(pt => {
    const row: number[] = [pt.timestamp];
    for (const key of keys) {
      const res = pt.resources[key];
      row.push(res ? res.remaining : -1);
    }
    return row;
  });

  return { v: 2, keys, lims, rsts, pts };
}

function decodeCompact(store: CompactStore): DataPoint[] {
  const { keys, lims, rsts, pts } = store;
  return pts.map(row => {
    const timestamp = row[0];
    const resources: Record<string, StoredResourceData> = {};
    for (let i = 0; i < keys.length; i++) {
      const remaining = row[i + 1];
      if (remaining !== -1) {
        resources[keys[i]] = {
          remaining,
          limit: lims[i],
          used: lims[i] - remaining,
          reset: rsts[i] || undefined,
        };
      }
    }
    return { timestamp, resources };
  });
}

export function loadData(): DataPoint[] {
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // v2 compact format
    if (parsed && parsed.v === 2) return decodeCompact(parsed as CompactStore);
    // Legacy: array of DataPoint objects
    if (Array.isArray(parsed)) return parsed as DataPoint[];
    return [];
  } catch {
    return [];
  }
}

export function saveData(data: DataPoint[]): void {
  const compact = encodeCompact(data);
  let json = JSON.stringify(compact);

  // Trim oldest entries if over the size budget
  while (json.length > MAX_STORAGE_CHARS && compact.pts.length > 10) {
    const removeCount = Math.max(1, Math.floor(compact.pts.length * 0.1));
    compact.pts.splice(0, removeCount);
    json = JSON.stringify(compact);
  }

  try {
    localStorage.setItem(DATA_KEY, json);
  } catch {
    // QuotaExceededError — trim more aggressively then retry
    compact.pts.splice(0, Math.floor(compact.pts.length / 2));
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(compact));
    } catch {
      /* give up */
    }
  }
}

export function clearAllData(): void {
  localStorage.removeItem(DATA_KEY);
}

export function getStorageInfo(): { points: number; sizeKB: number } {
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return { points: 0, sizeKB: 0 };
  try {
    const parsed = JSON.parse(raw);
    let points = 0;
    if (parsed && parsed.v === 2) {
      points = Array.isArray(parsed.pts) ? parsed.pts.length : 0;
    } else if (Array.isArray(parsed)) {
      points = parsed.length;
    }
    return {
      points,
      sizeKB: Math.round((raw.length / 1024) * 10) / 10,
    };
  } catch {
    return { points: 0, sizeKB: 0 };
  }
}

export function exportCSV(data: DataPoint[]): void {
  if (data.length === 0) return;

  // Collect all resource names
  const allResources = new Set<string>();
  for (const point of data) {
    for (const key of Object.keys(point.resources)) {
      allResources.add(key);
    }
  }
  const resourceNames = Array.from(allResources).sort();

  // Header
  const headers = ['Timestamp'];
  for (const name of resourceNames) {
    headers.push(`${name}_remaining`, `${name}_limit`, `${name}_used`);
  }

  // Rows
  const rows = [headers.join(',')];
  for (const point of data) {
    const row = [new Date(point.timestamp).toISOString()];
    for (const name of resourceNames) {
      const res = point.resources[name];
      if (res) {
        row.push(String(res.remaining), String(res.limit), String(res.used));
      } else {
        row.push('', '', '');
      }
    }
    rows.push(row.join(','));
  }

  // Download
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `github-rate-limits-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
