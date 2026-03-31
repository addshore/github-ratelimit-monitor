import { getToken, clearToken, initiateLogin, listenForAuth } from './auth';
import { loadData, saveData, clearAllData, exportCSV, getStorageInfo } from './storage';
import { ChartManager } from './chart-manager';
import { getColor } from './colors';
import { DemoGenerator } from './demo';
import { getDescription } from './descriptions';
import type {
  DataPoint,
  AppSettings,
  RateLimitResponse,
  ViewMode,
  DisplayMode,
  TimeWindow,
  TooltipMode,
} from './types';
import { TIME_WINDOW_MS } from './types';
import './style.css';

// ---- State ----
let settings: AppSettings;
let data: DataPoint[] = [];
let knownLimits: string[] = [];
let isDemo = false;
let isPaused = false;
let worker: Worker | null = null;
let demoGenerator: DemoGenerator | null = null;
let demoTimerId: number | null = null;
let currentUser: { login: string; avatar_url: string } | null = null;
const chartManager = new ChartManager();

// ---- DOM helper ----
const $ = (id: string) => document.getElementById(id)!;

// ---- Settings ----
function loadSettings(): AppSettings {
  const defaults: AppSettings = {
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
  try {
    const raw = localStorage.getItem('app_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Guard against duplicates that would create double datasets
      if (Array.isArray(parsed.visibleLimits)) {
        parsed.visibleLimits = [...new Set<string>(parsed.visibleLimits)];
      }
      return { ...defaults, ...parsed };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function saveSettings(): void {
  localStorage.setItem('app_settings', JSON.stringify(settings));
}

// ---- Init ----
function init(): void {
  settings = loadSettings();
  chartManager.init($('charts-container'));
  listenForAuth(onAuthenticated);
  initUI();

  if (getToken()) {
    startLiveMode(getToken()!);
  } else {
    startDemoMode();
  }
}

function onAuthenticated(token: string): void {
  stopDemoMode();
  startLiveMode(token);
  updateAuthUI(true);
}

// ---- Auth UI ----
function updateAuthUI(loggedIn: boolean): void {
  $('demo-banner').style.display = loggedIn ? 'none' : 'flex';

  const section = $('auth-section');
  if (loggedIn) {
    const userHtml = currentUser
      ? `<a href="https://github.com/${currentUser.login}" target="_blank" rel="noopener" class="username-link">@${currentUser.login}</a>`
      : 'Authenticated';
    section.innerHTML = `
      <div class="auth-status">
        <span class="status-dot active"></span>
        <span>${userHtml}</span>
      </div>
      <button id="logout-btn" class="btn btn-small">Logout</button>
    `;
    $('logout-btn').onclick = () => {
      currentUser = null;
      clearToken();
      stopLiveMode();
      startDemoMode();
      updateAuthUI(false);
    };
  } else {
    section.innerHTML =
      '<button id="login-btn" class="btn btn-primary full-width">Login with GitHub</button>';
    $('login-btn').onclick = () => initiateLogin();
  }
}

async function fetchUser(token: string): Promise<void> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const user = (await res.json()) as { login: string; avatar_url: string };
      currentUser = user;
      updateAuthUI(true);
    }
  } catch { /* non-critical */ }
}

// ---- Live Mode ----
function startLiveMode(token: string): void {
  isDemo = false;
  isPaused = false;
  data = loadData();
  discoverLimits(data);
  chartManager.render(data, settings);
  fetchUser(token);

  worker = new Worker(new URL('./poll-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { type, payload } = e.data;
    switch (type) {
      case 'data':
        handleRateLimitData(payload as RateLimitResponse);
        break;
      case 'auth_error':
        clearToken();
        stopLiveMode();
        startDemoMode();
        updateAuthUI(false);
        break;
      case 'error':
        console.error('Poll error:', payload);
        break;
      case 'status':
        updatePollingStatus(payload as 'polling' | 'paused' | 'stopped');
        if (payload === 'paused') {
          isPaused = true;
          updatePauseBtn();
        } else if (payload === 'polling') {
          isPaused = false;
          updatePauseBtn();
        }
        break;
    }
  };

  worker.postMessage({
    type: 'start',
    payload: { token, intervalMs: settings.intervalSeconds * 1000 },
  });
}

function stopLiveMode(): void {
  worker?.postMessage({ type: 'stop' });
  worker?.terminate();
  worker = null;
  updatePollingStatus('stopped');
}

function handleRateLimitData(response: RateLimitResponse): void {
  updateRawPanel(response);

  const point: DataPoint = { timestamp: Date.now(), resources: {} };
  for (const [name, res] of Object.entries(response.resources)) {
    point.resources[name] = {
      remaining: res.remaining,
      limit: res.limit,
      used: res.used,
      reset: res.reset,
    };
  }

  data.push(point);
  saveData(data);

  const newLimits = Object.keys(point.resources).filter((k) => !knownLimits.includes(k));
  if (newLimits.length > 0) {
    knownLimits.push(...newLimits);
    knownLimits.sort();
    settings.visibleLimits = [...new Set([...settings.visibleLimits, ...newLimits])];
    saveSettings();
    renderLimitCheckboxes();
    chartManager.setSettings(settings);
  }

  chartManager.addDataPoint(point);
  updateStorageInfo();
}

// ---- Demo Mode ----
function startDemoMode(): void {
  isDemo = true;
  isPaused = false;
  demoGenerator = new DemoGenerator();
  data = demoGenerator.generateHistory(30, settings.intervalSeconds * 1000);
  discoverLimits(data);
  chartManager.render(data, settings);
  updatePollingStatus('polling');

  if (data.length > 0) {
    const last = data[data.length - 1];
    updateRawPanel({ _demo: true, resources: last.resources });
  }

  demoTimerId = window.setInterval(() => {
    if (!demoGenerator) return;
    const point = demoGenerator.generate();
    data.push(point);
    chartManager.addDataPoint(point);
    updateRawPanel({ _demo: true, resources: point.resources });
  }, settings.intervalSeconds * 1000);
}

function stopDemoMode(): void {
  if (demoTimerId !== null) { clearInterval(demoTimerId); demoTimerId = null; }
  demoGenerator = null;
  data = [];
  updatePollingStatus('stopped');
}

// ---- Polling controls ----
function pausePolling(): void {
  if (isDemo) {
    if (demoTimerId !== null) { clearInterval(demoTimerId); demoTimerId = null; }
    isPaused = true;
    updatePollingStatus('paused');
    updatePauseBtn();
    return;
  }
  worker?.postMessage({ type: 'pause' });
  // status will be received via message
}

function resumePolling(): void {
  if (isDemo) {
    if (demoGenerator) restartDemoTimer();
    isPaused = false;
    updatePollingStatus('polling');
    updatePauseBtn();
    return;
  }
  worker?.postMessage({ type: 'resume' });
  // status will be received via message
}

function checkNow(): void {
  if (isDemo) {
    if (!demoGenerator) return;
    const point = demoGenerator.generate();
    data.push(point);
    chartManager.addDataPoint(point);
    updateRawPanel({ _demo: true, resources: point.resources });
    return;
  }
  worker?.postMessage({ type: 'pollNow' });
}

// ---- Helpers ----
function discoverLimits(dataPoints: DataPoint[]): void {
  const set = new Set<string>(knownLimits);
  for (const p of dataPoints) for (const k of Object.keys(p.resources)) set.add(k);
  knownLimits = Array.from(set).sort();

  if (settings.visibleLimits.length === 0) {
    settings.visibleLimits = [...knownLimits];
    saveSettings();
  }
  renderLimitCheckboxes();
}

function updatePollingStatus(status: 'polling' | 'paused' | 'stopped'): void {
  const dot = document.querySelector('#polling-status .status-dot') as HTMLElement | null;
  const text = document.querySelector('#polling-status .status-text') as HTMLElement | null;
  if (dot) {
    dot.className = 'status-dot';
    if (status === 'polling') dot.classList.add('active');
    else if (status === 'paused') dot.classList.add('paused');
  }
  if (text) {
    text.textContent =
      status === 'polling' ? (isDemo ? 'Demo' : 'Polling') :
      status === 'paused' ? 'Paused' : 'Stopped';
  }
}

function updatePauseBtn(): void {
  const btn = document.getElementById('pause-btn') as HTMLButtonElement | null;
  if (btn) btn.textContent = isPaused ? 'Resume' : 'Pause';
}

function updateRawPanel(payload: unknown): void {
  const pre = document.getElementById('raw-json');
  const ts = document.getElementById('raw-timestamp');
  if (pre) pre.textContent = JSON.stringify(payload, null, 2);
  if (ts) ts.textContent = new Date().toLocaleTimeString();
}

function updateStorageInfo(): void {
  const info = getStorageInfo();
  const countEl = $('data-points-count');
  const sizeEl = $('data-size');
  if (countEl) countEl.textContent = `${info.points} pts`;
  if (sizeEl)
    sizeEl.textContent = info.sizeKB >= 1024
      ? `${(info.sizeKB / 1024).toFixed(1)} MB`
      : `${info.sizeKB} KB`;
}

// ---- UI Wiring ----
function initUI(): void {
  updateAuthUI(!!getToken());

  // Interval
  const intervalInput = $('interval-input') as HTMLInputElement;
  intervalInput.value = String(settings.intervalSeconds);
  intervalInput.addEventListener('change', () => {
    const val = parseInt(intervalInput.value, 10);
    if (val >= 1 && val <= 3600) {
      settings.intervalSeconds = val;
      saveSettings();
      worker?.postMessage({ type: 'updateInterval', payload: { intervalMs: val * 1000 } });
      restartDemoTimer();
    }
  });

  // Pause / Resume
  $('pause-btn').onclick = () => isPaused ? resumePolling() : pausePolling();

  // Check Now
  $('check-now-btn').onclick = () => checkNow();

  // View mode
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="viewMode"]')) {
    if (el.value === settings.viewMode) el.checked = true;
    el.addEventListener('change', () => {
      settings.viewMode = el.value as ViewMode;
      saveSettings();
      chartManager.setSettings(settings);
    });
  }

  // Display mode
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="displayMode"]')) {
    if (el.value === settings.displayMode) el.checked = true;
    el.addEventListener('change', () => {
      settings.displayMode = el.value as DisplayMode;
      saveSettings();
      chartManager.setSettings(settings);
    });
  }

  // Tooltip mode
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="tooltipMode"]')) {
    if (el.value === settings.tooltipMode) el.checked = true;
    el.addEventListener('change', () => {
      settings.tooltipMode = el.value as TooltipMode;
      saveSettings();
      chartManager.setSettings(settings);
    });
  }

  // Time window — slider
  const TIME_WINDOW_VALUES: TimeWindow[] = ['30m', '1h', '2h', '6h', '24h', 'all'];
  const sliderEl = $('time-window-slider') as HTMLInputElement;
  const sliderIdx = TIME_WINDOW_VALUES.indexOf(settings.timeWindow);
  sliderEl.value = String(sliderIdx >= 0 ? sliderIdx : 2);
  sliderEl.addEventListener('input', () => {
    settings.timeWindow = TIME_WINDOW_VALUES[Number(sliderEl.value)];
    saveSettings();
    chartManager.setSettings(settings);
  });

  // Overlays
  const resetLinesEl = $('show-reset-lines') as HTMLInputElement;
  resetLinesEl.checked = settings.showResetLines;
  resetLinesEl.addEventListener('change', () => {
    settings.showResetLines = resetLinesEl.checked;
    saveSettings();
    chartManager.setSettings(settings);
  });

  const trendLinesEl = $('show-trend-lines') as HTMLInputElement;
  trendLinesEl.checked = settings.showTrendLines;
  trendLinesEl.addEventListener('change', () => {
    settings.showTrendLines = trendLinesEl.checked;
    saveSettings();
    chartManager.setSettings(settings);
  });

  const pinYMinEl = $('pin-y-min') as HTMLInputElement;
  pinYMinEl.checked = settings.pinYMin;
  pinYMinEl.addEventListener('change', () => {
    settings.pinYMin = pinYMinEl.checked;
    saveSettings();
    chartManager.setSettings(settings);
  });

  const pinYMaxEl = $('pin-y-max') as HTMLInputElement;
  pinYMaxEl.checked = settings.pinYMax;
  pinYMaxEl.addEventListener('change', () => {
    settings.pinYMax = pinYMaxEl.checked;
    saveSettings();
    chartManager.setSettings(settings);
  });

  // Select all / none / in-use
  $('select-all-btn').onclick = () => {
    settings.visibleLimits = [...knownLimits];
    saveSettings();
    renderLimitCheckboxes();
    chartManager.setSettings(settings);
  };
  $('select-none-btn').onclick = () => {
    settings.visibleLimits = [];
    saveSettings();
    renderLimitCheckboxes();
    chartManager.setSettings(settings);
  };
  $('select-in-use-btn').onclick = () => {
    const lastPoint = data[data.length - 1];
    settings.visibleLimits = knownLimits.filter(n => (lastPoint?.resources[n]?.used ?? 0) > 0);
    saveSettings();
    renderLimitCheckboxes();
    chartManager.setSettings(settings);
  };

  // Download CSV
  $('download-csv-btn').onclick = () => exportCSV(isDemo ? data : loadData());

  // Clear data outside current time window
  $('clear-window-btn').onclick = () => {
    if (settings.timeWindow === 'all') {
      alert('Time window is set to "All" — nothing to clear.');
      return;
    }
    const cutoffLabel = settings.timeWindow;
    if (confirm(`Delete all data points older than the current time window (${cutoffLabel})?`)) {
      const cutoff = Date.now() - TIME_WINDOW_MS[settings.timeWindow];
      if (!isDemo) {
        const kept = loadData().filter((p: DataPoint) => p.timestamp >= cutoff);
        saveData(kept);
        data = kept;
      } else {
        data = data.filter(p => p.timestamp >= cutoff);
      }
      chartManager.setData(data);
      updateStorageInfo();
    }
  };

  // Clear all data
  $('clear-data-btn').onclick = () => {
    if (confirm('Clear all stored rate limit data?')) {
      clearAllData();
      if (!isDemo) { data = []; chartManager.setData([]); }
      updateStorageInfo();
    }
  };

  // Banner login link
  $('login-link').onclick = (e) => { e.preventDefault(); initiateLogin(); };

  updateStorageInfo();
}

function restartDemoTimer(): void {
  if (!demoGenerator) return;
  if (demoTimerId !== null) clearInterval(demoTimerId);
  if (isPaused) return;
  demoTimerId = window.setInterval(() => {
    if (!demoGenerator) return;
    const point = demoGenerator.generate();
    data.push(point);
    chartManager.addDataPoint(point);
    updateRawPanel({ _demo: true, resources: point.resources });
  }, settings.intervalSeconds * 1000);
}

function renderLimitCheckboxes(): void {
  const container = $('limits-checkboxes');
  container.innerHTML = '';
  const lastPoint = data[data.length - 1];

  for (const name of knownLimits) {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.title = getDescription(name);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = settings.visibleLimits.includes(name);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!settings.visibleLimits.includes(name)) settings.visibleLimits.push(name);
      } else {
        settings.visibleLimits = settings.visibleLimits.filter((l) => l !== name);
      }
      saveSettings();
      chartManager.setSettings(settings);
    });

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.backgroundColor = getColor(name);

    const used = lastPoint?.resources[name]?.used ?? 0;
    if (used > 0) {
      const badge = document.createElement('span');
      badge.className = 'in-use-badge';
      badge.title = `${used} requests in use`;
      badge.textContent = String(used);
      label.append(cb, dot, document.createTextNode(` ${name} `), badge);
    } else {
      label.append(cb, dot, document.createTextNode(` ${name}`));
    }
    container.appendChild(label);
  }
}

document.addEventListener('DOMContentLoaded', init);
