// Public real BTC/USD ticks. This worker is independent of any browser.
// Node 22+ supplies WebSocket; no API key or third-party package is needed.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function decodeFeedMessage(data) {
  const tick = JSON.parse(data);
  if (tick.product_id !== 'BTC-USD') return null;
  if (tick.type === 'ticker') {
    const price = String(tick.price ?? '');
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price) ||
        !Number.isFinite(Number(price)) || Number(price) <= 0) return null;
    return { type: 'ticker', price, time: tick.time, sequence: tick.sequence };
  }
  if (tick.type === 'heartbeat') return { type: 'heartbeat', time: tick.time };
  return null;
}

export function runFeed() {
  let socket, reconnect, watchdog, stopping = false;
  let delay = 1000, blocked = false;
  const latest = new Map();
  // Respect stdout backpressure: at most one unsent ticker and heartbeat.
  function emit(tick) {
    if (blocked) { latest.set(tick.type, tick); return; }
    blocked = !process.stdout.write(JSON.stringify(tick) + '\n');
  }
  process.stdout.on('drain', () => {
    blocked = false;
    for (const [type, tick] of latest) {
      latest.delete(type);
      emit(tick);
      if (blocked) break;
    }
  });
  function connect() {
    if (stopping) return;
    const current = socket = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    let lastMessage = Date.now();
    current.onopen = () => {
      delay = 1000;
      current.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker', 'heartbeat'] }));
    };
    current.onmessage = event => {
      lastMessage = Date.now();
      try { const tick = decodeFeedMessage(event.data); if (tick) emit(tick); }
      catch (error) { console.error('Invalid feed message:', error.message); }
    };
    current.onerror = event => console.error('BTC feed connection:', event.message || 'connection error');
    current.onclose = () => {
      clearInterval(watchdog);
      if (!stopping) { reconnect = setTimeout(connect, delay); delay = Math.min(30000, delay * 2); }
    };
    watchdog = setInterval(() => {
      if (Date.now() - lastMessage > 15000) current.close();
    }, 1000);
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(reconnect);
    clearInterval(watchdog);
    try { socket?.close(); } finally { process.exit(0); }
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.stdout.on('error', error => {
    if (error.code !== 'EPIPE') console.error(error.message);
    stop();
  });
  connect();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runFeed();
