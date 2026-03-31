import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import type { DataPoint, AppSettings, DisplayMode, TimeWindow } from './types';
import { TIME_WINDOW_MS } from './types';
import { getColor } from './colors';

function getValue(point: DataPoint, resource: string, mode: DisplayMode): number | null {
  const res = point.resources[resource];
  if (!res) return null;
  switch (mode) {
    case 'remaining': return res.remaining;
    case 'used': return res.used;
    case 'percentage': return res.limit > 0 ? (res.remaining / res.limit) * 100 : 0;
  }
}

function getYAxisLabel(mode: DisplayMode): string {
  switch (mode) {
    case 'remaining': return 'Remaining';
    case 'used': return 'Used';
    case 'percentage': return '% Remaining';
  }
}

function filterByTimeWindow(data: DataPoint[], window: TimeWindow): DataPoint[] {
  if (window === 'all') return data;
  const cutoff = Date.now() - TIME_WINDOW_MS[window];
  return data.filter((p) => p.timestamp >= cutoff);
}

export class ChartManager {
  private container: HTMLElement | null = null;
  private combinedChart: Chart | null = null;
  private individualCharts: Map<string, Chart> = new Map();
  private allData: DataPoint[] = [];
  private settings: AppSettings = {
    intervalSeconds: 10,
    viewMode: 'combined',
    displayMode: 'remaining',
    visibleLimits: [],
    timeWindow: '2h',
    tooltipMode: 'nearest',
    showResetLines: false,
    showTrendLines: false,
    pinYMin: false,
    pinYMax: false,
  };
  private currentResetTimes: Record<string, number> = {};

  init(container: HTMLElement): void {
    this.container = container;
  }

  render(data: DataPoint[], settings: AppSettings): void {
    this.allData = data;
    this.settings = settings;
    this.syncResetTimesFromData();
    this.rebuild();
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
    this.rebuild();
  }

  setData(data: DataPoint[]): void {
    this.allData = data;
    this.syncResetTimesFromData();
    this.rebuild();
  }

  addDataPoint(point: DataPoint): void {
    this.allData.push(point);
    this.updateResetTimesFromPoint(point);
    if (this.settings.viewMode === 'combined' && this.combinedChart) {
      this.refreshCombined();
    } else if (this.settings.viewMode === 'individual') {
      this.refreshIndividual();
    }
  }

  private syncResetTimesFromData(): void {
    this.currentResetTimes = {};
    for (let i = this.allData.length - 1; i >= 0; i--) {
      for (const [name, res] of Object.entries(this.allData[i].resources)) {
        if (!(name in this.currentResetTimes) && res.reset) {
          this.currentResetTimes[name] = res.reset * 1000;
        }
      }
    }
  }

  private updateResetTimesFromPoint(point: DataPoint): void {
    for (const [name, res] of Object.entries(point.resources)) {
      if (res.reset) this.currentResetTimes[name] = res.reset * 1000;
    }
  }

  private makeResetLinePlugin() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const mgr = this;
    return {
      id: 'resetLines',
      afterDraw(chart: Chart) {
        if (!mgr.settings.showResetLines) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ctx, chartArea, scales } = chart as any;
        const xScale = scales['x'];
        if (!xScale || !chartArea) return;
        ctx.save();
        for (const [resource, resetMs] of Object.entries(mgr.currentResetTimes)) {
          if (!mgr.settings.visibleLimits.includes(resource)) continue;
          const xPixel = xScale.getPixelForValue(resetMs as number);
          if (xPixel < chartArea.left || xPixel > chartArea.right) continue;
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = getColor(resource);
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(xPixel, chartArea.top);
          ctx.lineTo(xPixel, chartArea.bottom);
          ctx.stroke();
        }
        ctx.restore();
      },
    };
  }

  private getMaxLimit(): number | undefined {
    let max: number | undefined;
    for (const resource of this.settings.visibleLimits) {
      for (let i = this.allData.length - 1; i >= 0; i--) {
        const res = this.allData[i].resources[resource];
        if (res) {
          const lim = res.limit ?? 0;
          if (max === undefined || lim > max) max = lim;
          break;
        }
      }
    }
    return max;
  }

  private buildSingleTrendDataset(resource: string): Record<string, unknown> | null {
    if (!this.settings.showTrendLines) return null;
    const now = Date.now();
    const resetMs = this.currentResetTimes[resource];
    if (!resetMs || resetMs <= now) return null;

    // Most recent polled point
    const lastPoint = this.allData.slice().reverse().find((p) => p.resources[resource]);
    if (!lastPoint) return null;
    const res = lastPoint.resources[resource];
    if (!res) return null;

    // Find the start of the current rate-limit window: the last point where
    // the resource was at full capacity (remaining==limit or used==0).
    const anchor = this.findLastResetPoint(resource);
    if (!anchor) return null;

    const anchorY = getValue(anchor, resource, this.settings.displayMode);
    const currentY = getValue(lastPoint, resource, this.settings.displayMode);
    if (anchorY === null || currentY === null) return null;

    // Observed drain/usage rate (units per ms) since the last reset
    const dtObserved = lastPoint.timestamp - anchor.timestamp;
    const rate = dtObserved > 0 ? (currentY - anchorY) / dtObserved : 0;

    // Project to the next reset time
    const rawEndY = anchorY + rate * (resetMs - anchor.timestamp);
    const maxY = this.settings.displayMode === 'percentage' ? 100 : res.limit;
    const endY = Math.max(0, Math.min(maxY, rawEndY));

    return {
      label: `${resource} (trend)`,
      // Draw from the reset-anchor point through to the projected reset time
      data: [{ x: anchor.timestamp, y: anchorY }, { x: resetMs, y: endY }],
      borderColor: getColor(resource),
      backgroundColor: 'transparent',
      borderDash: [4, 4],
      borderWidth: 1.5,
      pointRadius: [0, 4],
      fill: false,
      tension: 0,
      _isTrend: true,
      _trendEndY: endY,
      _trendResetMs: resetMs,
    };
  }

  /** Walk backward to find the last data point where the resource was at
   *  full capacity (remaining === limit or used === 0), i.e. just after a reset.
   *  Falls back to the oldest available point for the resource. */
  private findLastResetPoint(resource: string): DataPoint | null {
    for (let i = this.allData.length - 1; i >= 0; i--) {
      const res = this.allData[i].resources[resource];
      if (!res) continue;
      if (res.remaining === res.limit || res.used === 0) return this.allData[i];
    }
    return this.allData.find((p) => p.resources[resource]) ?? null;
  }


  private buildTrendDatasets(): Record<string, unknown>[] {
    if (!this.settings.showTrendLines) return [];
    return this.settings.visibleLimits
      .map((r) => this.buildSingleTrendDataset(r))
      .filter((d): d is Record<string, unknown> => d !== null);
  }

  private buildDatasets(data: DataPoint[]): Record<string, unknown>[] {
    return this.settings.visibleLimits.map((resource) => ({
      label: resource,
      data: data
        .map((p) => ({ x: p.timestamp, y: getValue(p, resource, this.settings.displayMode) }))
        .filter((d): d is { x: number; y: number } => d.y !== null),
      borderColor: getColor(resource),
      backgroundColor: getColor(resource) + '20',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
    }));
  }

  private chartOptions() {
    const tm = this.settings.tooltipMode;
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      interaction: { mode: tm as 'nearest' | 'index', intersect: tm === 'nearest' },
      scales: {
        x: {
          type: 'time' as const,
          time: {
            tooltipFormat: 'HH:mm:ss',
            displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm', hour: 'HH:mm' },
          },
          grid: { color: '#333' },
          ticks: { color: '#999', maxTicksLimit: 12 },
        },
        y: {
          title: { display: true, text: getYAxisLabel(this.settings.displayMode), color: '#999' },
          grid: { color: '#333' },
          ticks: { color: '#999' },
          min: (this.settings.pinYMin || this.settings.displayMode === 'percentage') ? 0 : undefined,
          max: this.settings.displayMode === 'percentage' ? 100 : (this.settings.pinYMax ? this.getMaxLimit() : undefined),
        },
      },
      plugins: {
        legend: {
          display: this.settings.viewMode === 'combined',
          labels: {
            color: '#e0e0e0',
            usePointStyle: true,
            pointStyle: 'circle' as const,
            filter: (item: { text: string }) => !item.text.endsWith('(trend)'),
          },
        },
        tooltip: {
          mode: tm as 'nearest' | 'index',
          intersect: tm === 'nearest',
          // Show real datasets normally; only show the endpoint (index=1) of trend datasets.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: (item: any) => !item.dataset._isTrend || item.dataIndex === 1,
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (item: any) => {
              const ds = item.dataset;
              if (ds._isTrend) {
                const val = typeof ds._trendEndY === 'number' ? Math.round(ds._trendEndY) : item.formattedValue;
                const resource = (ds.label as string).replace(' (trend)', '');
                return `${resource} → predicted at reset: ${val}`;
              }
              return `${ds.label}: ${item.formattedValue}`;
            },
          },
        },
      },
    };
  }

  private rebuild(): void {
    this.destroyAll();
    if (!this.container) return;
    if (this.settings.viewMode === 'combined') {
      this.buildCombinedChart();
    } else {
      this.buildIndividualCharts();
    }
  }

  private buildCombinedChart(): void {
    if (!this.container) return;
    this.container.className = '';
    this.container.innerHTML = '<div class="chart-wrapper combined"><canvas></canvas></div>';
    const canvas = this.container.querySelector('canvas')!;
    const filtered = filterByTimeWindow(this.allData, this.settings.timeWindow);
    this.combinedChart = new Chart(canvas, {
      type: 'line',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { datasets: [...this.buildDatasets(filtered), ...this.buildTrendDatasets()] as any },
      options: this.chartOptions(),
      plugins: [this.makeResetLinePlugin()],
    });
  }

  private buildIndividualCharts(): void {
    if (!this.container) return;
    this.container.className = 'individual-grid';
    this.container.innerHTML = '';
    const filtered = filterByTimeWindow(this.allData, this.settings.timeWindow);

    for (const resource of this.settings.visibleLimits) {
      const wrapper = document.createElement('div');
      wrapper.className = 'chart-wrapper individual';
      const canvas = document.createElement('canvas');
      wrapper.appendChild(canvas);
      this.container.appendChild(wrapper);

      const points = filtered
        .map((p) => ({ x: p.timestamp, y: getValue(p, resource, this.settings.displayMode) }))
        .filter((d): d is { x: number; y: number } => d.y !== null);

      const trendDs = this.buildSingleTrendDataset(resource);
      const baseOpts = this.chartOptions();

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          datasets: [
            {
              label: resource,
              data: points,
              borderColor: getColor(resource),
              backgroundColor: getColor(resource) + '20',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            ...(trendDs ? [trendDs] : []),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ] as any,
        },
        options: {
          ...baseOpts,
          plugins: {
            ...baseOpts.plugins,
            title: {
              display: true,
              text: resource,
              color: '#e0e0e0',
              font: { size: 14 },
            },
          },
        },
        plugins: [this.makeResetLinePlugin()],
      });

      this.individualCharts.set(resource, chart);
    }
  }

  private refreshCombined(): void {
    if (!this.combinedChart) return;
    const filtered = filterByTimeWindow(this.allData, this.settings.timeWindow);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.combinedChart.data.datasets = [...this.buildDatasets(filtered), ...this.buildTrendDatasets()] as any;
    this.combinedChart.update('none');
  }

  private refreshIndividual(): void {
    const filtered = filterByTimeWindow(this.allData, this.settings.timeWindow);
    for (const [resource, chart] of this.individualCharts) {
      const points = filtered
        .map((p) => ({ x: p.timestamp, y: getValue(p, resource, this.settings.displayMode) }))
        .filter((d): d is { x: number; y: number } => d.y !== null);
      const trendDs = this.buildSingleTrendDataset(resource);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (chart.data.datasets[0]) (chart.data.datasets[0] as any).data = points;
      if (trendDs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (chart.data.datasets[1]) chart.data.datasets[1] = trendDs as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else chart.data.datasets.push(trendDs as any);
      } else if (chart.data.datasets.length > 1) {
        chart.data.datasets.splice(1, chart.data.datasets.length - 1);
      }
      chart.update('none');
    }
  }

  private destroyAll(): void {
    this.combinedChart?.destroy();
    this.combinedChart = null;
    for (const chart of this.individualCharts.values()) chart.destroy();
    this.individualCharts.clear();
  }
}
