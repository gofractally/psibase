export const CANDLE_INTERVALS = [5, 15, 60, 3600, 86400];
const MAX_WIDE = (1n << 128n) - 1n;
function amount(value, name) {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid candle ${name}.`);
  const result = BigInt(value);
  if (result <= 0n || result > MAX_WIDE) throw new Error(`Invalid candle ${name}.`);
  return result;
}
export function candleHistory(result, interval) {
  if (!CANDLE_INTERVALS.includes(interval) || Number(result?.interval) !== interval || !Array.isArray(result?.candles) || result.candles.length > 200) throw new Error('Invalid native candle page.');
  const pricePrecision=result.price_precision;
  if(!Number.isInteger(pricePrecision)||pricePrecision<0||pricePrecision>36)throw new Error('Invalid candle price precision.');
  const seen = new Set();
  const candles = result.candles.map(row => {
    if (!((typeof row.time === 'number' && Number.isSafeInteger(row.time)) || (typeof row.time === 'string' && /^\d+$/.test(row.time)))) throw new Error('Invalid candle time.');
    const seconds = Number(row.time);
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds % interval !== 0 || seconds * 1000 > 8640000000000000 || seen.has(seconds)) throw new Error('Invalid candle time.');
    seen.add(seconds);
    const open = amount(row.open, 'open'), high = amount(row.high, 'high'), low = amount(row.low, 'low'), close = amount(row.close, 'close');
    if (high < open || high < close || low > open || low > close || low > high || typeof row.complete !== 'boolean') throw new Error('Invalid candle range.');
    return {time:seconds * 1000,open,high,low,close,volume:amount(row.volume,'volume'),trades:amount(row.trades,'count'),complete:row.complete,event_id:row.event_id == null ? null : String(row.event_id)};
  }).sort((a,b)=>a.time-b.time);
  const before = result.next_before;
  if (before != null && (typeof before !== 'string' || before.length > 256 || before.length === 0)) throw new Error('Invalid candle history cursor.');
  return {candles,before:before ?? null,pricePrecision};
}
export function candleTimeLabel(time, interval) {
  const date = new Date(time);
  return interval >= 86400 ? date.toLocaleDateString([], {month:'short',day:'numeric',timeZone:'UTC'})
    : interval >= 3600 ? date.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})
    : date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
// How many candles the chart shows at each zoom level. The chart always draws
// this many slots, so a candle is the same width whatever the history holds.
export const CANDLE_ZOOMS = [30, 60, 120, 200];
// The candles the chart shows: the latest `count` of a page, each in a slot of
// its own from the right edge, whatever time lies between them. `gap` marks a
// candle that does not directly follow the one before it.
export function chartWindow(candles, count, interval) {
  if (!CANDLE_ZOOMS.includes(count)) throw new Error('Unsupported chart zoom.');
  const shown = candles.slice(-count);
  return shown.map((candle, index) => ({candle, slot: count - shown.length + index,
    gap: index > 0 && candle.time - shown[index - 1].time > interval * 1000}));
}
