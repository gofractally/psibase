// Amounts and transaction arguments stay integers end to end. Number is used
// only by the SVG chart to map an already-computed price onto display pixels.
export const UINT64_MAX = (1n << 64n) - 1n;
export const COMMITTED_MAX = (1n << 40n) - 1n;
export function committed(value, name = 'Committed amount') {
  const n = integer(value, name);
  if (n > COMMITTED_MAX) throw new Error(`${name} exceeds this service’s checked arithmetic limit (${COMMITTED_MAX} native atoms).`);
  return n;
}
export function integer(value, name = 'Value', allowZero = false) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be a whole number.`);
  const n = BigInt(text);
  if (n > UINT64_MAX || n < (allowZero ? 0n : 1n)) throw new Error(`${name} is outside the allowed range.`);
  return n;
}
export function atoms(value, precision, name = 'Amount', allowZero = false) {
  const text = String(value).trim();
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new Error('Unsupported token precision.');
  if (!/^(?:\d+)(?:\.\d+)?$/.test(text)) throw new Error(`${name} must be a positive decimal number.`);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > precision) throw new Error(`${name} supports at most ${precision} decimal places.`);
  return integer(BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0'), name, allowZero);
}
export function decimal(value, precision, maxFraction = precision, group = true) {
  let n;
  try { n = BigInt(value ?? 0); } catch { return '—'; }
  const negative = n < 0n;
  if (negative) n = -n;
  const scale = 10n ** BigInt(precision);
  let whole = String(n / scale);
  if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = String(n % scale).padStart(precision, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
export function priceAtoms(tick, market, baseToken, quoteToken) {
  return BigInt(tick) * BigInt(market.quote_tick) * 10n ** BigInt(baseToken.precision) / BigInt(market.base_lot);
}
export function priceText(tick, market, baseToken, quoteToken) {
  return decimal(priceAtoms(tick, market, baseToken, quoteToken), quoteToken.precision, Math.min(quoteToken.precision, 6));
}
export function priceTick(input, market, baseToken, quoteToken) {
  const numerator = atoms(input, quoteToken.precision, 'Price') * BigInt(market.base_lot);
  const denominator = BigInt(market.quote_tick) * 10n ** BigInt(baseToken.precision);
  if (numerator % denominator) throw new Error('Price must be an exact multiple of this market’s price tick.');
  return integer(numerator / denominator, 'Price tick');
}
export function ceilDiv(a, b) { return (a + b - 1n) / b; }
export function relayOutput(market, sellBase, input) {
  const reserveIn = BigInt(sellBase ? market.x : market.y);
  const reserveOut = BigInt(sellBase ? market.y : market.x);
  const remaining = ceilDiv(BigInt(market.k), reserveIn + BigInt(input));
  return reserveOut > remaining ? reserveOut - remaining : 0n;
}
export function relayPrice(market, baseToken, quoteToken) {
  if (!BigInt(market.x || 0)) return '—';
  const p = BigInt(market.y) * 10n ** BigInt(baseToken.precision) / BigInt(market.x);
  return decimal(p, quoteToken.precision, Math.min(quoteToken.precision, 4));
}
export function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
