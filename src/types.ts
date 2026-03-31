export interface RateLimitResource {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

export interface RateLimitResponse {
  resources: Record<string, RateLimitResource>;
}

export interface StoredResourceData {
  remaining: number;
  limit: number;
  used: number;
  reset?: number; // Unix timestamp in seconds (optional for backward-compat)
}

export interface DataPoint {
  timestamp: number;
  resources: Record<string, StoredResourceData>;
}

export type ViewMode = 'combined' | 'individual';
export type DisplayMode = 'remaining' | 'percentage' | 'used';
export type TimeWindow = '30m' | '1h' | '2h' | '6h' | '24h' | 'all';
export type TooltipMode = 'nearest' | 'index';

export interface AppSettings {
  intervalSeconds: number;
  viewMode: ViewMode;
  displayMode: DisplayMode;
  visibleLimits: string[];
  timeWindow: TimeWindow;
  tooltipMode: TooltipMode;
  showResetLines: boolean;
  showTrendLines: boolean;
  pinYMin: boolean; // force Y axis min to 0
  pinYMax: boolean; // force Y axis max to limit (remaining/percentage) or limit (used)
}

export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  'all': Infinity,
};
