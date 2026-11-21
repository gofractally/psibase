import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atoms, integer, committed, decimal, priceTick, priceText, relayOutput, relayPrice, safeText } from '../src/amounts.js';

const btc = { precision: 8 }, usd = { precision: 4 };
const market = { base_lot: '10000', quote_tick: '1', x: '10000000000', y: '100000000000', k: '1000000000000000000000' };

test('native amounts above Number precision stay exact', () => {
  assert.equal(atoms('90071992.54740993', 8), 9007199254740993n);
  assert.equal(atoms('0.00000001', 8), 1n);
  assert.equal(atoms('123.4567', 4), 1234567n);
  assert.equal(decimal(9007199254740993n, 8, 8, false), '90071992.54740993');
  assert.equal(decimal(1234500000n, 4), '123,450');
});
test('invalid decimals cannot become financial arguments', () => {
  for (const text of ['1e8', '-1', '+1', '.1', '1.', '1,000', 'NaN', 'Infinity', '', '1.000000001', '<script>']) assert.throws(() => atoms(text, 8));
  assert.throws(() => atoms('0', 8));
  assert.equal(atoms('0.00', 8, 'Amount', true), 0n);
  assert.throws(() => integer('18446744073709551616'));
  assert.equal(integer('18446744073709551615'), (1n << 64n) - 1n);
  assert.equal(committed((1n << 40n) - 1n), (1n << 40n) - 1n);
  assert.throws(() => committed(1n << 40n));
});
test('BTC/USD display and limit ticks round trip in atom units', () => {
  assert.equal(priceTick('100000', market, btc, usd), 100000n);
  assert.equal(priceText(100000n, market, btc, usd), '100,000');
  assert.equal(priceTick('80000', market, btc, usd), 80000n);
  assert.throws(() => priceTick('80000.5', market, btc, usd));
  assert.equal(relayPrice(market, btc, usd), '100,000');
});
test('relay estimates use exact protected product and ceiling output reserve', () => {
  assert.equal(relayOutput(market, true, 100000000n), 990099009n);
  assert.equal(relayOutput(market, false, 1000000000n), 99009900n);
  const tiny = { x: '3', y: '4', k: '12' };
  assert.equal(relayOutput(tiny, true, 1n), 1n);
  assert.equal(relayOutput(tiny, false, 1n), 0n);
});
test('token symbols and chain errors are escaped before HTML rendering', () => {
  assert.equal(safeText('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
  assert.equal(safeText("a'b&c"), 'a&#39;b&amp;c');
});
