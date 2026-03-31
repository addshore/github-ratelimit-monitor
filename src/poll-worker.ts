// Web Worker — runs in a dedicated thread so polling continues when the tab is backgrounded.
const ctx = self as any; // eslint-disable-line @typescript-eslint/no-explicit-any

let token: string | null = null;
let intervalMs = 10000;
let timerId: ReturnType<typeof setInterval> | null = null;

ctx.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;
  switch (type) {
    case 'start':
      token = payload?.token ?? null;
      intervalMs = payload?.intervalMs ?? 10000;
      startPolling();
      break;
    case 'stop':
      stopPolling();
      break;
    case 'pause':
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      ctx.postMessage({ type: 'status', payload: 'paused' });
      break;
    case 'resume':
      if (token) startPolling();
      break;
    case 'pollNow':
      poll();
      break;
    case 'updateInterval':
      intervalMs = payload?.intervalMs ?? intervalMs;
      if (timerId !== null) {
        stopPolling();
        startPolling();
      }
      break;
    case 'updateToken':
      token = payload?.token ?? null;
      break;
  }
};

async function poll() {
  if (!token) return;
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      ctx.postMessage({ type: 'data', payload: data });
    } else if (res.status === 401 || res.status === 403) {
      ctx.postMessage({ type: 'auth_error' });
      stopPolling();
    } else {
      ctx.postMessage({ type: 'error', payload: `HTTP ${res.status}` });
    }
  } catch (err: any) {
    ctx.postMessage({ type: 'error', payload: err.message });
  }
}

function startPolling() {
  poll(); // immediate first check
  timerId = setInterval(poll, intervalMs);
  ctx.postMessage({ type: 'status', payload: 'polling' });
}

function stopPolling() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  ctx.postMessage({ type: 'status', payload: 'stopped' });
}
