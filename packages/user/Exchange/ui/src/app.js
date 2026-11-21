import { atoms, decimal, integer, committed as commit, priceTick, priceText, relayOutput, relayPrice, safeText as esc, ceilDiv } from './amounts.js';
import { creditStatus, fundingPaused } from './market-policy.js';

const $ = selector => document.querySelector(selector);
const state = { account: localStorage.getItem('relay-account') || 'alice', market: null, data: null, side: 'buy', type: 'market', ticket: 'spot', orderTab: 'orders', pending: false, online: false, activity: [], refresh: 0, fetches: 0 };
let toastTimer;
const tokenCache = new Map();
const value = v => BigInt(v?.value ?? v ?? 0);
const key = v => String(v?.value ?? v ?? '');
const own = row => key(row.owner ?? row.account) === state.account;
const sameMarket = row => key(row.market) === key(state.market);
const token = id => state.data?.tokens?.find(t => key(t.id ?? t.token_id) === key(id)) || tokenCache.get(key(id)) || { id, symbol: `#${id}`, precision: 0 };
const precision = t => Number(t.precision?.value ?? t.precision ?? 0);
const symbol = t => String(t.symbol || t.ticker || `#${t.id}`).toUpperCase();
const market = () => state.data?.markets?.find(m => key(m.id) === key(state.market));
const assets = m => ({ b: token(m.base), q: token(m.quote) });
const fmt = (v, t, places = precision(t)) => decimal(value(v), precision(t), places);
const price = (p, m = market()) => { const { b, q } = assets(m); return priceText(p, m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) }); };
const balance = id => state.data?.balances?.find(b => key(b.token ?? b.token_id) === key(id)) || {};
const available = id => value(balance(id).spendable ?? value(balance(id).incoming) + value(balance(id).outgoing)) + accrued(id);
const levels = m => (state.data?.levels || []).filter(l => key(l.market) === key(m.id) && l.active !== false && value(l.outgoing) > 0n);
const coin = t => `<span class="coin ${symbol(t) === 'BTC' ? 'coin-btc' : symbol(t) === 'USD' ? 'coin-usd' : 'coin-other'}">${symbol(t) === 'BTC' ? '₿' : symbol(t) === 'USD' ? '$' : esc(symbol(t).slice(0, 1))}</span>`;
const empty = (heading, message, icon = '≋') => `<div class="empty-state"><span class="empty-icon">${icon}</span><strong>${esc(heading)}</strong><span>${esc(message)}</span></div>`;
function accrued(id) {
  if (!state.data) return 0n;
  let amount = 0n;
  for (const p of state.data.positions || []) if (own(p)) {
    const m = (state.data.markets || []).find(m => key(m.id) === key(p.market));
    if (m && !fundingPaused(m) && key(p.bid ? m.base : m.quote) === key(id)) amount += value(p.proceeds);
  }
  for (const p of state.data.loan_positions || []) if (own(p)) {
    const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation));
    const m = (state.data.markets || []).find(m => key(m.id) === key(p.market));
    if (g && g.active === false && m && !fundingPaused(m) && key(g.long ? m.quote : m.base) === key(id)) amount += value(p.units) * value(g.original_surplus) / (value(g.original_units) || 1n);
  }
  return amount;
}

async function api(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data;
  try { data = await response.json(); } catch { throw new Error(`The local chain bridge returned HTTP ${response.status}.`); }
  if (!response.ok || data.error || data.ok === false) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Transaction rejected (HTTP ${response.status}).`);
  return data;
}
async function resolveToken(id) {
  const n = integer(id, 'Token ID');
  if (n > 4294967295n) throw new Error('Token ID must fit a native u32.');
  const cached = state.data?.tokens?.find(t => key(t.id ?? t.token_id) === String(n)) || tokenCache.get(String(n));
  if (cached) return cached;
  const result = await api(`/api/tokens?after=${n - 1n}&limit=1`);
  const found = (result.tokens || result.rows || []).find(t => key(t.id ?? t.token_id) === String(n));
  if (!found) throw new Error(`Native token #${n} does not exist.`);
  tokenCache.set(String(n), found);
  return found;
}
function toast(text, type = '') {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').className = type;
  $('#toast').hidden = false;
  if (type !== 'pending') toastTimer = setTimeout(() => { $('#toast').hidden = true; }, type === 'error' ? 12000 : 5500);
}
function setPending(pending) {
  state.pending = pending;
  document.querySelectorAll('button[type="submit"], button[data-action], button[data-position-action]').forEach(button => { button.disabled = pending || button.dataset.locked === 'true'; });
  $('#account').disabled = pending;
}
async function transact(label, method, args) {
  return submit(label, '/api/action', { account: state.account, method, args });
}
async function submit(label, path, args) {
  if (state.pending) return;
  setPending(true);
  toast(`${label} · submitting to Psibase…`, 'pending');
  try {
    const result = await api(path, args);
    const id = result.transactionId || result.transaction_id || result.id || '';
    state.activity.unshift({ label, time: new Date(), id: key(id) });
    state.activity = state.activity.slice(0, 30);
    toast(`${label} confirmed${id ? ` · ${key(id).slice(0, 12)}…` : ''}`);
    if ($('#modal').open) $('#modal').close();
    await refresh();
    return result;
  } catch (error) { toast(error.message, 'error'); }
  finally { setPending(false); }
}
async function refresh() {
  const seq = ++state.refresh;
  state.fetches++;
  try {
    const data = await api(`/api/state?account=${encodeURIComponent(state.account)}`);
    if (seq !== state.refresh) return;
    state.data = data.snapshot || data.data || data;
    const first = state.data.markets?.[0];
    if (!state.data.markets?.some(m => key(m.id) === key(state.market))) state.market = first?.id ?? null;
    state.online = true;
    $('#connection-banner').hidden = true;
    const height = state.data.block ?? state.data.lastBlock ?? state.data.network?.block;
    $('#chain-status').innerHTML = `<i></i> Psibase connected${height ? ` · block ${esc(height)}` : ''}`;
    $('#chain-status').className = '';
    render();
  } catch (error) {
    state.online = false;
    $('#connection-banner').textContent = `Local chain unavailable: ${error.message} Retrying automatically.`;
    $('#connection-banner').hidden = false;
    $('#chain-status').innerHTML = '<i></i> Reconnecting';
    $('#chain-status').className = 'offline';
    if (!state.data) $('#orders-content').innerHTML = empty('Connecting to your exchange', 'The interface reads live native chain state.');
  } finally { state.fetches--; }
}

function render() {
  const markets = state.data.markets || [];
  const signature = markets.map(m => `${m.id}:${m.base}:${m.quote}`).join(',');
  if ($('#market-select').dataset.signature !== signature) {
    $('#market-select').innerHTML = markets.length ? markets.map(m => `<option value="${esc(m.id)}">${esc(symbol(token(m.base)))} / ${esc(symbol(token(m.quote)))} · #${esc(m.id)}</option>`).join('') : '<option value="">No market yet</option>';
    $('#market-select').dataset.signature = signature;
  }
  $('#market-select').value = key(state.market);
  $('#balance-account').textContent = state.account;
  renderBalances(); renderMarketList();
  const m = market();
  if (!m) {
    $('#depth-chart').innerHTML = '<div class="chart-empty">Fund an initial relay to create the first market.</div>';
    $('#orders-content').innerHTML = empty('Your next market starts here', 'Create a market with two native tokens and initial liquidity.');
    if (!$('#ticket-content').innerHTML) $('#ticket-content').innerHTML = empty('No active market', 'Create and fund a market to start trading.');
    return;
  }
  const { b, q } = assets(m);
  const mid = relayPrice(m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) });
  for (const selector of ['#ticker-price', '#book-mid-price', '#chart-price']) $(selector).textContent = mid;
  $('.pair-select>.coin').outerHTML = coin(b);
  document.querySelectorAll('.base-symbol').forEach(el => { el.textContent = symbol(b); });
  document.querySelectorAll('.quote-symbol').forEach(el => { el.textContent = symbol(q); });
  $('#reserve-base-label').textContent = `${symbol(b)} liquidity`;
  $('#reserve-quote-label').textContent = `${symbol(q)} liquidity`;
  $('#ticker-base').textContent = `${fmt(m.x, b, 5)} ${symbol(b)}`;
  $('#ticker-quote').textContent = `${fmt(m.y, q, 2)} ${symbol(q)}`;
  $('#ticker-levels').textContent = String(levels(m).length);
  $('#pair-subtitle').textContent = `Lot ${fmt(m.base_lot, b)} ${symbol(b)} · tick ${price(1n, m)} ${symbol(q)}`;
  $('#pair-subtitle').title = `Market #${m.id}: base_lot=${m.base_lot} native base atoms, quote_tick=${m.quote_tick} native quote atoms per lot per price tick.`;
  const credit = creditStatus(m);
  $('#market-mode').textContent = credit.label;
  $('#market-mode').className = `market-mode ${credit.enabled ? 'enabled' : fundingPaused(m) ? 'paused' : 'spot-only'}`;
  $('#market-mode').title = credit.reason || 'This book was funded with tokens eligible for protected margin lending.';
  if (!$('#ticket-content').dataset.ready || (state.ticket === 'margin' && $('#ticket-content').dataset.credit !== String(credit.enabled))) renderTicket();
  renderBook(); renderChart(); renderOrders(); renderEarn(); updateEstimates();
}

function renderBook() {
  const m = market(); const { b, q } = assets(m);
  for (const bid of [false, true]) {
    let rows = levels(m).filter(l => Boolean(l.bid) === bid).sort((a, z) => value(a.price) < value(z.price) ? -1 : value(a.price) > value(z.price) ? 1 : 0);
    if (bid) rows.reverse();
    rows = rows.slice(0, 8);
    if (!bid) rows.reverse();
    const sizes = rows.map(l => bid ? value(l.outgoing) / (value(l.price) * value(m.quote_tick)) * value(m.base_lot) : value(l.outgoing) / value(m.base_lot) * value(m.base_lot));
    const max = sizes.reduce((a, v) => v > a ? v : a, 1n);
    const content = rows.map((l, i) => {
      const quote = sizes[i] / value(m.base_lot) * value(l.price) * value(m.quote_tick);
      const depth = String(sizes[i] * 10000n / max / 100n);
      return `<div class="book-row" style="--depth:${depth}%" data-price="${esc(l.price)}" tabindex="0" role="button" aria-label="Set limit price ${esc(price(l.price))}"><span>${esc(price(l.price))}</span><span>${esc(fmt(sizes[i], b, 6))}</span><span>${esc(fmt(quote, q, 2))}</span></div>`;
    }).join('');
    $(bid ? '#bids' : '#asks').innerHTML = content || `<div class="empty-book"><strong>No resting ${bid ? 'bids' : 'asks'}</strong><span>The relay still provides liquidity.</span></div>`;
  }
}
function renderChart() {
  const m = market(); const { b, q } = assets(m);
  const x = value(m.x), y = value(m.y), k = value(m.k);
  if (!x || !y || !k) return;
  // SVG geometry only: no plotted Number is ever used for a transaction.
  const W = 600, H = 222, left = 55, right = W - 20, top = 12, bottom = H - 27;
  const mid = Number(y) / Number(x) * 10 ** (precision(b) - precision(q));
  const low = mid * .72, high = mid * 1.28, range = high - low;
  const px = p => left + (p - low) / range * (right - left);
  const py = n => bottom - n * (bottom - top);
  const bids = [], asks = [];
  for (let i = 0; i <= 28; i++) {
    const fraction = i / 28 * .28;
    const priceLow = mid * (1 - fraction), priceHigh = mid * (1 + fraction);
    const sell = Math.sqrt(Number(k) / (priceLow / 10 ** (precision(b) - precision(q)))) - Number(x);
    const buy = Number(x) - Math.sqrt(Number(k) / (priceHigh / 10 ** (precision(b) - precision(q))));
    bids.push({ p: priceLow, amount: Math.max(0, sell) }); asks.push({ p: priceHigh, amount: Math.max(0, buy) });
  }
  const max = Math.max(bids.at(-1).amount, asks.at(-1).amount, 1);
  const path = points => points.map((v, i) => `${i ? 'L' : 'M'}${px(v.p).toFixed(2)},${py(v.amount / max).toFixed(2)}`).join(' ');
  const bidPath = path(bids), askPath = path(asks);
  const maximumUnits = max / 10 ** precision(b);
  const axisDecimals = Math.min(precision(b), maximumUnits < .001 ? 8 : maximumUnits < 1 ? 6 : 3);
  const grid = [.25, .5, .75, 1].map(v => `<line x1="${left}" x2="${right}" y1="${py(v)}" y2="${py(v)}" stroke="#223044" stroke-dasharray="2 5"/><text x="${left - 8}" y="${py(v) + 3}" fill="#627994" font-size="9" text-anchor="end">${(max * v / 10 ** precision(b)).toLocaleString(undefined, { maximumFractionDigits: axisDecimals })}</text>`).join('');
  const labels = [low, mid * .86, mid, mid * 1.14, high].map(p => `<text x="${px(p)}" y="${H - 7}" fill="#7187a1" font-size="9" text-anchor="middle">${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}</text>`).join('');
  const makerMarks = levels(m).filter(l => { const p = Number(value(l.price) * value(m.quote_tick)) / Number(value(m.base_lot)) * 10 ** (precision(b) - precision(q)); return p >= low && p <= high; }).map(l => { const p = Number(value(l.price) * value(m.quote_tick)) / Number(value(m.base_lot)) * 10 ** (precision(b) - precision(q)); return `<line x1="${px(p)}" x2="${px(p)}" y1="${bottom - 7}" y2="${bottom + 2}" stroke="${l.bid ? '#33d4a3' : '#f47888'}" stroke-width="2"/>`; }).join('');
  $('#depth-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Current relay depth, with limit price markers"><defs><linearGradient id="bidFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#33d4a3" stop-opacity=".21"/><stop offset="1" stop-color="#33d4a3" stop-opacity=".015"/></linearGradient><linearGradient id="askFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f47888" stop-opacity=".19"/><stop offset="1" stop-color="#f47888" stop-opacity=".015"/></linearGradient></defs>${grid}<path d="${bidPath} L${px(low)},${bottom} L${px(mid)},${bottom} Z" fill="url(#bidFill)"/><path d="${askPath} L${px(high)},${bottom} L${px(mid)},${bottom} Z" fill="url(#askFill)"/><path d="${bidPath}" stroke="#33d4a3" fill="none" stroke-width="2"/><path d="${askPath}" stroke="#f47888" fill="none" stroke-width="2"/><line x1="${px(mid)}" x2="${px(mid)}" y1="${top}" y2="${bottom}" stroke="#4e6685" stroke-dasharray="3 5"/><line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="#2d3d52"/>${makerMarks}${labels}<text x="${left}" y="8" fill="#627994" font-size="8">${esc(symbol(b))}</text></svg>`;
}

function renderTicket() {
  if (!market()) return;
  const m = market(); const { b, q } = assets(m);
  const sell = state.side === 'sell'; const input = sell ? b : q;
  $('#ticket-content').dataset.ready = '1';
  const credit = creditStatus(m);
  $('#ticket-content').dataset.credit = String(credit.enabled);
  if (state.ticket === 'margin' && !credit.enabled) {
    $('#ticket-content').innerHTML = `<div class="ticket-body"><div class="credit-unavailable"><span>◇</span><h3>${esc(credit.label)}</h3><p>${esc(credit.reason)}</p><button type="button" class="button subtle" data-view="markets">Browse markets</button></div><p class="help-inline">You can still manage existing orders and repay existing positions below.</p></div>`;
    return;
  }
  if (state.ticket === 'margin') {
    $('#ticket-content').innerHTML = `<form id="margin-form" class="ticket-body"><div class="buy-sell-toggle"><button type="button" class="${!sell ? 'active' : ''}" data-side="buy">Long ${esc(symbol(b))}</button><button type="button" class="${sell ? 'active' : ''}" data-side="sell">Short ${esc(symbol(b))}</button></div><div class="available-row"><span>Collateral available</span><strong id="ticket-available">—</strong></div><label>Liquidation trigger price<div class="input-wrap"><input name="price" inputmode="decimal" placeholder="0.00" required><span>${esc(symbol(q))}</span></div></label><label>Loan units<div class="input-wrap"><input name="units" inputmode="numeric" value="1" required><span>units</span></div></label><div id="order-estimate" class="estimate-box"></div><button type="submit" class="button ${sell ? 'sell' : 'buy'}">Borrow ${esc(symbol(sell ? b : q))}</button><p class="help-inline">Collateral is locked at a shared trigger price. The chain rejects loans that exceed the complete liquidation schedule’s protected relay capacity. Financing is included in fixed face debt.</p><button class="button ghost" type="button" data-action="liquidate" style="margin-top:15px">Process due price cohorts</button><button class="button ghost" type="button" data-action="renew" title="Start a new 30-day lending term after all debt is closed" style="margin-top:8px">Renew lending term</button></form>`;
    const spotPrice = value(m.y) * value(m.base_lot) / (value(m.x) * value(m.quote_tick));
    const suggested = spotPrice * (sell ? 120n : 80n) / 100n;
    $('#margin-form input[name=price]').value = price(suggested).replace(/,/g, '');
  } else {
    $('#ticket-content').innerHTML = `<form id="spot-form" class="ticket-body"><div class="buy-sell-toggle"><button type="button" class="${!sell ? 'active' : ''}" data-side="buy">Buy</button><button type="button" class="${sell ? 'active' : ''}" data-side="sell">Sell</button></div><div class="order-type"><button type="button" data-type="market" class="${state.type === 'market' ? 'active' : ''}">Market</button><button type="button" data-type="limit" class="${state.type === 'limit' ? 'active' : ''}">Limit</button></div><div class="available-row"><span>Available</span><strong id="ticket-available">—</strong></div>${state.type === 'limit' ? `<label>Limit price<div class="input-wrap"><input name="price" inputmode="decimal" placeholder="0.00" required><span>${esc(symbol(q))}</span></div></label>` : ''}<label>${sell ? 'Amount to sell' : 'Amount to spend'}<div class="input-wrap"><input name="amount" inputmode="decimal" placeholder="${precision(input) > 2 ? '0.00000000' : '0.00'}" required><span>${esc(symbol(input))}</span></div></label><div class="percentage-row">${[25, 50, 75, 100].map(n => `<button type="button" data-percent="${n}">${n}%</button>`).join('')}</div>${state.type === 'market' ? '<label>Slippage limit<div class="input-wrap"><input name="slippage" inputmode="decimal" value="1.00" required><span>%</span></div></label>' : ''}<div id="order-estimate" class="estimate-box"></div><button type="submit" class="button ${sell ? 'sell' : 'buy'}">${sell ? 'Sell' : 'Buy'} ${esc(symbol(b))}</button><p class="help-inline">${state.type === 'limit' ? 'Orders at the same price share fills proportionally. A marketable limit executes up to your price and posts its remaining amount.' : 'Your order consumes relay liquidity between shared price pools. Minimum output is enforced atomically on chain.'}</p></form>`;
    if (state.type === 'limit') {
      const current = value(m.y) * value(m.base_lot) / (value(m.x) * value(m.quote_tick));
      $('#spot-form input[name=price]').value = price(current * (sell ? 105n : 95n) / 100n).replace(/,/g, '');
    }
  }
  updateEstimates();
}
function estimateLine(label, text) { return `<div class="estimate-line"><span>${esc(label)}</span><strong>${esc(text)}</strong></div>`; }
function updateEstimates() {
  const m = market(); if (!m) return;
  const { b, q } = assets(m); const sell = state.side === 'sell';
  const spotSubmit = $('#spot-form button[type=submit]');
  if (spotSubmit) { spotSubmit.dataset.locked = String(fundingPaused(m)); spotSubmit.disabled = state.pending || fundingPaused(m); }
  const input = sell ? b : q; const output = sell ? q : b;
  const renew = $('[data-action=renew]');
  if (renew) { renew.dataset.locked = String(value(m.debt_base) > 0n || value(m.debt_quote) > 0n); renew.disabled = state.pending || renew.dataset.locked === 'true'; }
  if ($('#ticket-available')) {
    const t = state.ticket === 'margin' ? (sell ? q : b) : input;
    $('#ticket-available').textContent = `${fmt(available(t.id), t)} ${symbol(t)}`;
  }
  const area = $('#order-estimate'); if (!area) { updateLiquidityPreview(); return; }
  try {
    if (state.ticket === 'margin') {
      const form = $('#margin-form'); const p = priceTick(form.elements.price.value, m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) }); const units = integer(form.elements.units.value, 'Loan units');
      const face = units * (sell ? value(m.base_lot) : p * value(m.quote_tick));
      const coll = units * (sell ? 2n * p * value(m.quote_tick) : 2n * value(m.base_lot));
      const feeUnit = ceilDiv((sell ? value(m.base_lot) : p * value(m.quote_tick)) * value(m.fee_bps ?? state.data.fee_bps ?? 100), 10000n);
      const advance = face - feeUnit * units;
      area.innerHTML = estimateLine('Collateral locked', `${fmt(coll, sell ? q : b)} ${symbol(sell ? q : b)}`) + estimateLine('You receive', `${fmt(advance, sell ? b : q)} ${symbol(sell ? b : q)}`) + estimateLine('Fixed face debt', `${fmt(face, sell ? b : q)} ${symbol(sell ? b : q)}`) + estimateLine('Coverage', 'Checked against all earlier price cohorts') + (m.maturity ? estimateLine('Credit maturity', new Date(Number(m.maturity) * 1000).toLocaleDateString()) : '');
    } else {
      const form = $('#spot-form'); const amount = atoms(form.elements.amount.value || '0', precision(input), 'Amount', true);
      let expected;
      if (state.type === 'limit') {
        const p = priceTick(form.elements.price.value, m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) });
        expected = sell ? amount / value(m.base_lot) * p * value(m.quote_tick) : amount / (p * value(m.quote_tick)) * value(m.base_lot);
      } else expected = relayOutput(m, sell, amount);
      const slip = state.type === 'market' ? atoms(form.elements.slippage.value || '0', 2, 'Slippage', true) : 0n;
      if (slip > 5000n) throw new Error('Slippage must be 50% or less.');
      const minimum = expected * (10000n - slip) / 10000n;
      area.innerHTML = estimateLine(state.type === 'market' ? 'Relay estimate' : 'At full execution', `${fmt(expected, output)} ${symbol(output)}`) + (state.type === 'market' ? estimateLine('Minimum receive', `${fmt(minimum, output)} ${symbol(output)}`) : '') + estimateLine('Settlement', 'Psibase · atomic') + estimateLine('Trading fee', '0%');
    }
  } catch (error) { area.innerHTML = `<span class="subtext">${esc(error.message)}</span>`; }
  updateLiquidityPreview();
}

function renderOrders() {
  const m = market(); const { b, q } = assets(m);
  const positions = (state.data.positions || []).filter(p => own(p) && sameMarket(p));
  const loans = (state.data.loan_positions || []).filter(p => own(p) && sameMarket(p));
  $('#order-count').textContent = String(positions.length); $('#loan-count').textContent = String(loans.length);
  let html;
  if (state.orderTab === 'activity') {
    html = state.activity.length ? state.activity.map(a => `<div class="activity-item"><span>✓</span><div>${esc(a.label)}<small>${esc(a.id ? a.id.slice(0, 28) + '…' : 'Confirmed on the local chain')}</small></div><time>${esc(a.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time></div>`).join('') : empty('Your transactions, confirmed', 'Actions from this session will appear here.', '↗');
  } else if (state.orderTab === 'loans') {
    html = loans.length ? `<table class="data-table"><thead><tr><th>Position</th><th>Trigger</th><th>Debt / surplus</th><th>Units</th><th></th></tr></thead><tbody>${loans.map(p => {
      const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation)); if (!g) return '';
      const active = g.active !== false; const long = Boolean(g.long); const debtAsset = long ? q : b;
      const debt = active ? value(p.units) * value(g.face_unit) : value(p.units) * value(g.original_surplus ?? g.surplus) / (value(g.original_units) || 1n);
      return `<tr><td><span class="${long ? 'side-buy' : 'side-sell'}">${long ? 'Long' : 'Short'} ${esc(symbol(b))}</span></td><td>${esc(price(p.price ?? g.price))}</td><td>${esc(fmt(debt, debtAsset))} ${esc(symbol(debtAsset))}${active ? '' : '<br><small>Surplus · debt repaid</small>'}</td><td>${esc(p.units)}</td><td><button class="button small ${active ? 'subtle' : 'primary'}" data-position-action="${active ? 'repay' : 'claim'}" data-long="${long}" data-price="${esc(p.price ?? g.price)}" data-units="${esc(p.units)}">${active ? 'Repay' : 'Settle'}</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('No margin positions', 'Borrow against a shared liquidation price from the Margin tab.', '◇');
  } else {
    html = positions.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Price</th><th>Remaining</th><th>Accrued</th><th></th></tr></thead><tbody>${positions.map(p => {
      const l = (state.data.levels || []).find(l => key(l.id ?? l.generation) === key(p.generation)) || { shares: 0, outgoing: 0, index: 0, active: p.active };
      const supply = value(l.shares) || 1n; const remaining = p.refund !== undefined ? value(p.refund) : value(p.shares) * value(l.outgoing) / supply;
      const scale = 1n << 40n; const credit = p.proceeds !== undefined ? value(p.proceeds) : (value(p.shares) * value(l.index) - value(p.debt)) / scale;
      const outgoingToken = p.bid ? q : b; const incomingToken = p.bid ? b : q;
      return `<tr><td><span class="${p.bid ? 'side-buy' : 'side-sell'}">${p.bid ? 'Buy' : 'Sell'} ${esc(symbol(b))}</span></td><td>${esc(price(p.price))}</td><td>${esc(fmt(remaining, outgoingToken))} ${esc(symbol(outgoingToken))}</td><td>${esc(fmt(credit > 0n ? credit : 0n, incomingToken))} ${esc(symbol(incomingToken))}</td><td><button class="button small subtle" data-position-action="cancel" data-bid="${Boolean(p.bid)}" data-price="${esc(p.price)}">${l.active === false ? 'Settle' : 'Cancel'}</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('Your orders will appear here', 'Place a limit order to share fills at your chosen price.', '≋');
  }
  $('#orders-content').innerHTML = html;
  setPending(state.pending);
}

function committed(id) {
  let total = 0n;
  for (const p of state.data.positions || []) if (own(p)) {
    const m = state.data.markets.find(m => key(m.id) === key(p.market)); if (!m || key(p.bid ? m.quote : m.base) !== key(id)) continue;
    const l = (state.data.levels || []).find(l => key(l.id ?? l.generation) === key(p.generation));
    if (p.refund !== undefined) total += value(p.refund);
    else if (l) total += value(p.shares) * value(l.outgoing) / (value(l.shares) || 1n);
  }
  for (const p of state.data.loan_positions || []) if (own(p)) {
    const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation));
    const m = state.data.markets.find(m => key(m.id) === key(p.market));
    if (g && g.active !== false && m && key(g.long ? m.base : m.quote) === key(id)) total += value(p.units) * value(g.collateral_unit);
  }
  return total;
}
function renderBalances() {
  $('#balances').innerHTML = (state.data.tokens || []).map(t => {
    const row = balance(t.id); const name = symbol(t);
    return `<tr><td><div class="asset-name">${coin(t)}<div><strong>${esc(name)}</strong><small>Native token #${esc(t.id)}</small></div></div></td><td>${esc(fmt(row.wallet, t))}</td><td>${esc(fmt(available(t.id), t))}</td><td class="committed-amount" title="Your remaining order escrow and active loan collateral">${esc(fmt(committed(t.id), t))}</td><td><div class="balance-buttons"><button class="button ghost" data-funds="deposit" data-token="${esc(t.id)}">Deposit</button><button class="button ghost" data-funds="withdraw" data-token="${esc(t.id)}">Withdraw</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">No native tokens found.</td></tr>';
}
function renderMarketList() {
  $('#market-list').innerHTML = (state.data.markets || []).map(m => {
    const { b, q } = assets(m);
    const credit = creditStatus(m);
    return `<tr><td><div class="asset-name">${coin(b)}<div><strong>${esc(symbol(b))} / ${esc(symbol(q))} · #${esc(m.id)} <span class="market-mode ${credit.enabled ? 'enabled' : 'spot-only'}">${esc(credit.label)}</span></strong><small>Lot ${esc(fmt(m.base_lot, b))} ${esc(symbol(b))} · tick ${esc(price(1n, m))} ${esc(symbol(q))}</small></div></div></td><td>${esc(relayPrice(m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) }))}</td><td>${esc(fmt(m.x, b))} ${esc(symbol(b))}</td><td>${esc(fmt(m.y, q))} ${esc(symbol(q))}</td><td>${levels(m).length}</td><td><button class="button small subtle" data-select-market="${esc(m.id)}">Trade →</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:35px;color:var(--muted)">Create the first market with a funded relay.</td></tr>';
}
function renderEarn() {
  const m = market(); const { b, q } = assets(m);
  const credit = creditStatus(m);
  const lendSubmit = $('#lend-form button[type=submit]');
  lendSubmit.dataset.locked = String(!credit.enabled);
  lendSubmit.disabled = state.pending || !credit.enabled;
  $('#lend-eligibility').textContent = credit.reason;
  $('#lend-eligibility').hidden = credit.enabled;
  const liquiditySubmit = $('#liquidity-form button[type=submit]');
  liquiditySubmit.dataset.locked = String(fundingPaused(m));
  liquiditySubmit.disabled = state.pending || fundingPaused(m);
  const cells = [b, q].map((t, i) => `<div class="stat-cell"><small>${esc(symbol(t))} cash available</small><strong>${esc(fmt(i ? m.vault_quote : m.vault_base, t, i ? 2 : 5))}</strong><small class="unit">${esc(symbol(t))}</small></div>`).join('');
  $('#vault-stats').innerHTML = `<div class="vault-summary">${cells}</div>`;
  $('#lend-asset').options[0].textContent = symbol(q); $('#lend-asset').options[1].textContent = symbol(b);
  $('#lend-token').textContent = $('#lend-asset').value === 'true' ? symbol(b) : symbol(q);
  $('#relay-stats').innerHTML = `<div class="relay-summary"><div class="stat-cell"><small>${esc(symbol(b))} reserve</small><strong>${esc(fmt(m.x, b, 5))}</strong></div><div class="stat-cell"><small>${esc(symbol(q))} reserve</small><strong>${esc(fmt(m.y, q, 2))}</strong></div></div>`;
  const lenders = (state.data.lenders || []).filter(p => own(p) && sameMarket(p) && value(p.shares));
  $('#lender-positions').innerHTML = lenders.length ? lenders.map(p => {
    const base = Boolean(p.base); const t = base ? b : q;
    const supply = value(base ? m.lending_base : m.lending_quote) || 1n;
    const nav = value(base ? m.vault_base : m.vault_quote) + value(base ? m.debt_base : m.debt_quote);
    return `<div class="position-item"><div>${esc(fmt(value(p.shares) * nav / supply, t))} ${esc(symbol(t))}<small>${esc(p.shares)} lending shares</small></div><button class="button small subtle" data-position-action="unlend" data-base="${base}" data-shares="${esc(p.shares)}">Redeem</button></div>`;
  }).join('') : '<span class="subtext">You have no lending shares in this market.</span>';
  const position = (state.data.relay_shares || []).find(p => own(p) && sameMarket(p));
  $('#relay-position').innerHTML = position && value(position.shares) ? `<div class="position-item"><div>${esc(position.shares)} LP shares<small>Your share of this relay</small></div><button class="button small subtle" data-position-action="remliq" data-shares="${esc(position.shares)}">Remove</button></div>` : '<span class="subtext">You have no relay LP shares in this market.</span>';
}
function updateLiquidityPreview() {
  const m = market(); if (!m) return;
  const { b, q } = assets(m);
  try {
    const shares = integer($('#liquidity-form input[name=shares]').value || '0', 'Shares', true);
    const supply = value(m.lp_supply) || 1n;
    $('#liquidity-preview').innerHTML = estimateLine('Required base', `${fmt(ceilDiv(shares * value(m.x), supply), b)} ${symbol(b)}`) + estimateLine('Required quote', `${fmt(ceilDiv(shares * value(m.y), supply), q)} ${symbol(q)}`);
  } catch (error) { $('#liquidity-preview').textContent = error.message; }
}

function showFunds(mode, id) {
  const t = token(id); const deposit = mode === 'deposit';
  $('#modal-title').textContent = `${deposit ? 'Deposit' : 'Withdraw'} ${symbol(t)}`;
  $('#modal-content').innerHTML = `<form id="funds-form" class="modal-form" data-mode="${mode}" data-token="${esc(id)}"><div class="asset-action-note">${deposit ? 'Credit tokens from your native wallet to this exchange. Uncommitted funds remain identified with your account in the token service.' : 'Return available native credits to your wallet. Committed order escrow and margin collateral must be released first.'}</div><label>Amount<div class="input-wrap"><input name="amount" inputmode="decimal" placeholder="0.00" required autofocus><span>${esc(symbol(t))}</span></div></label><div class="estimate-line"><span>${deposit ? 'Wallet balance' : 'Available to withdraw'}</span><strong>${esc(fmt(deposit ? balance(id).wallet : available(id), t))} ${esc(symbol(t))}</strong></div><button class="button primary" type="submit">${deposit ? 'Deposit' : 'Withdraw'} ${esc(symbol(t))}</button></form>`;
  $('#modal').showModal();
}
function showCreate() {
  const options = (state.data?.tokens || []).map(t => `<option value="${esc(t.id)}">${esc(symbol(t))} · native token #${esc(t.id)}</option>`).join('');
  const current = market();
  const base = current ? token(current.base) : state.data?.tokens?.[0];
  const quote = current ? token(current.quote) : state.data?.tokens?.find(t => key(t.id) !== key(base?.id));
  $('#modal-title').textContent = 'Create a new market';
  $('#modal-content').innerHTML = `<form id="create-form" class="modal-form"><div class="asset-action-note">Choose any two native token IDs and fund a new independent relay. Symbols and precision are resolved from native token records, including reserved symbol mappings. Existing books for the same pair do not prevent creation.</div><datalist id="native-token-options">${options}</datalist><div class="row"><label>Base token ID<input name="base" inputmode="numeric" list="native-token-options" value="${esc(base?.id || '')}" required><small id="create-base-info">${esc(base ? `${symbol(base)} · ${precision(base)} decimal places` : 'Enter any native token ID')}</small></label><label>Quote token ID<input name="quote" inputmode="numeric" list="native-token-options" value="${esc(quote?.id || '')}" required><small id="create-quote-info">${esc(quote ? `${symbol(quote)} · ${precision(quote)} decimal places` : 'Enter any native token ID')}</small></label></div><div class="row"><label>Base reserve<input name="base_amount" inputmode="decimal" placeholder="1.0" required></label><label>Quote reserve<input name="quote_amount" inputmode="decimal" placeholder="100.0" required></label></div><div class="row"><label>Base lot (native atoms)<input name="base_lot" inputmode="numeric" value="${esc(current?.base_lot || '10000')}" required></label><label>Quote tick (native atoms)<input name="quote_tick" inputmode="numeric" value="${esc(current?.quote_tick || '1')}" required></label></div><p class="small-note" style="padding:0">Both reserves must be credited to the exchange first. Each book has its own lot/tick grid, reserves, LP ownership, and credit backstop. Guaranteed margin requires immutable transferable, unrecallable tokens; the chain validates eligibility.</p><button class="button primary" type="submit">Fund relay & create market</button></form>`;
  $('#modal').showModal();
}
function showShares(action, data) {
  $('#modal-title').textContent = action === 'remliq' ? 'Remove relay liquidity' : 'Redeem lending shares';
  $('#modal-content').innerHTML = `<form id="shares-form" class="modal-form" data-method="${action}" data-base="${esc(data.base ?? '')}"><div class="asset-action-note">${action === 'remliq' ? 'The chain will reject this withdrawal if the remaining relay cannot cover the complete liquidation schedule.' : 'Redemption must fit the vault’s available cash. Fixed loan receivables remain protected until repaid or liquidated.'}</div><label>Shares to redeem<input name="shares" inputmode="numeric" value="${esc(data.shares)}" required></label><button class="button primary" type="submit">${action === 'remliq' ? 'Remove liquidity' : 'Redeem shares'}</button></form>`;
  $('#modal').showModal();
}
function showRepay(data) {
  $('#modal-title').textContent = 'Repay margin loan';
  $('#modal-content').innerHTML = `<form id="repay-form" class="modal-form" data-long="${esc(data.long)}" data-price="${esc(data.price)}"><div class="asset-action-note">Repay fixed face debt with available tokens and release your proportional collateral. The financing charge is included in the face debt.</div><label>Loan units to repay<input name="units" inputmode="numeric" value="${esc(data.units)}" required></label><button class="button primary" type="submit">Repay & release collateral</button></form>`;
  $('#modal').showModal();
}
function setView(view) {
  for (const name of ['trade', 'lend', 'markets']) $(`#${name}-view`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
}
function selectMarket(id) {
  state.market = id; $('#ticket-content').dataset.ready = ''; render(); setView('trade');
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button,[data-price]'); if (!button) return;
  const d = button.dataset;
  if (d.view) setView(d.view);
  if (d.open === 'create') showCreate();
  if ('close' in d) $('#modal').close();
  if (d.funds) showFunds(d.funds, d.token);
  if (d.selectMarket) selectMarket(d.selectMarket);
  if (d.orderTab) { state.orderTab = d.orderTab; document.querySelectorAll('[data-order-tab]').forEach(el => el.classList.toggle('active', el === button)); if (market()) renderOrders(); }
  if (d.ticket) { state.ticket = d.ticket; document.querySelectorAll('[data-ticket]').forEach(el => el.classList.toggle('active', el === button)); renderTicket(); }
  if (d.side) { state.side = d.side; renderTicket(); }
  if (d.type) { state.type = d.type; renderTicket(); }
  if (d.percent && $('#spot-form')) {
    const m = market(); const t = token(state.side === 'sell' ? m.base : m.quote);
    $('#spot-form input[name=amount]').value = decimal(available(t.id) * BigInt(d.percent) / 100n, precision(t), precision(t), false);
    updateEstimates();
  }
  if (d.price && !d.positionAction && button.classList.contains('book-row')) {
    state.ticket = 'spot'; state.type = 'limit'; renderTicket();
    document.querySelectorAll('[data-ticket]').forEach(el => el.classList.toggle('active', el.dataset.ticket === 'spot'));
    $('#spot-form input[name=price]').value = price(d.price).replace(/,/g, ''); updateEstimates();
  }
  if (d.action === 'liquidate') await transact('Process due price cohorts', 'liquidate', { market: key(state.market), max_events: 64 });
  if (d.action === 'renew') await transact('Renew lending term', 'renew', { market: key(state.market) });
  if (d.positionAction) {
    if (['remliq', 'unlend'].includes(d.positionAction)) showShares(d.positionAction, d);
    else if (d.positionAction === 'repay') showRepay(d);
    else await transact(d.positionAction === 'cancel' ? 'Cancel / settle order' : 'Settle loan surplus', d.positionAction, { market: key(state.market), price: d.price, ...(d.positionAction === 'cancel' ? { bid: d.bid === 'true' } : { long: d.long === 'true' }) });
  }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target; if (state.pending) return;
  const f = new FormData(form); const m = market(); const { b, q } = m ? assets(m) : {};
  try {
    if (!m && !['funds-form', 'create-form'].includes(form.id)) throw new Error('Create or select a funded market first.');
    if (form.id === 'spot-form') {
      const sell = state.side === 'sell'; const input = sell ? b : q;
      const amount = commit(atoms(f.get('amount'), precision(input)));
      if (state.type === 'limit') await transact('Place limit order', 'limit', { market: key(m.id), bid: !sell, price: String(priceTick(f.get('price'), m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) })), amount: String(amount) });
      else {
        const slip = atoms(f.get('slippage'), 2, 'Slippage', true); if (slip > 5000n) throw new Error('Slippage must be 50% or less.');
        const expected = relayOutput(m, sell, amount); const minimum = expected * (10000n - slip) / 10000n;
        if (minimum < 1n) throw new Error('Order is too small for a nonzero minimum output.');
        await transact(`${sell ? 'Sell' : 'Buy'} ${symbol(b)}`, 'trade', { market: key(m.id), sell_base: sell, amount: String(amount), min_output: String(minimum), max_events: 128 });
      }
    } else if (form.id === 'margin-form') {
      if (!creditStatus(m).enabled) throw new Error(creditStatus(m).reason);
      const long = state.side !== 'sell';
      const p = priceTick(f.get('price'), m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) });
      const units = integer(f.get('units'), 'Loan units');
      commit(units * (long ? 2n * value(m.base_lot) : 2n * p * value(m.quote_tick)), 'Loan collateral');
      commit(units * (long ? p * value(m.quote_tick) : value(m.base_lot)), 'Loan face debt');
      await transact('Open margin loan', 'borrow', { market: key(m.id), long, price: String(p), units: String(units) });
    }
    else if (form.id === 'lend-form') { if (!creditStatus(m).enabled) throw new Error(creditStatus(m).reason); const base = f.get('base') === 'true'; await transact('Supply lending vault', 'lend', { market: key(m.id), base, amount: String(commit(atoms(f.get('amount'), precision(base ? b : q)))) }); }
    else if (form.id === 'liquidity-form') await transact('Add relay liquidity', 'addliq', { market: key(m.id), shares: String(commit(f.get('shares'), 'LP shares')) });
    else if (form.id === 'funds-form') await submit(`${form.dataset.mode === 'deposit' ? 'Deposit' : 'Withdraw'} ${symbol(token(form.dataset.token))}`, `/api/${form.dataset.mode}`, { account: state.account, tokenId: Number(form.dataset.token), amount: String(atoms(f.get('amount'), precision(token(form.dataset.token)))) });
    else if (form.id === 'shares-form') await transact(form.dataset.method === 'remliq' ? 'Remove relay liquidity' : 'Redeem lending shares', form.dataset.method, { market: key(m.id), shares: String(integer(f.get('shares'), 'Shares')), ...(form.dataset.method === 'unlend' ? { base: form.dataset.base === 'true' } : {}) });
    else if (form.id === 'repay-form') await transact('Repay margin loan', 'repay', { market: key(m.id), long: form.dataset.long === 'true', price: form.dataset.price, units: String(integer(f.get('units'), 'Loan units')) });
    else if (form.id === 'create-form') {
      const base = await resolveToken(f.get('base')), quote = await resolveToken(f.get('quote'));
      if (key(base.id) === key(quote.id)) throw new Error('Choose two different tokens.');
      const previous = new Set((state.data.markets || []).map(m => key(m.id)));
      const result = await transact('Create funded market', 'create', { base: Number(base.id), quote: Number(quote.id), base_amount: String(commit(atoms(f.get('base_amount'), precision(base)), 'Base reserve')), quote_amount: String(commit(atoms(f.get('quote_amount'), precision(quote)), 'Quote reserve')), base_lot: String(commit(f.get('base_lot'), 'Base lot')), quote_tick: String(commit(f.get('quote_tick'), 'Quote tick')) });
      const returnedId = result?.trace?.actionTraces?.at(-1)?.retval;
      const candidates = result ? (state.data.markets || []).filter(m => !previous.has(key(m.id))) : [];
      const created = (state.data.markets || []).find(m => returnedId !== undefined && key(m.id) === key(returnedId)) || (candidates.length === 1 ? candidates[0] : null);
      if (created) selectMarket(created.id);
    }
  } catch (error) { toast(error.message, 'error'); }
});
document.addEventListener('input', event => { if (event.target.closest('#ticket-content')) updateEstimates(); if (event.target.closest('#liquidity-form')) updateLiquidityPreview(); });
$('#lend-asset').addEventListener('change', () => renderEarn());
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.closest('#create-form') && ['base', 'quote'].includes(el.name)) {
    const info = $(`#create-${el.name}-info`);
    const requested = el.value;
    info.textContent = 'Resolving native token…';
    try {
      const t = await resolveToken(requested);
      if (el.value === requested) info.textContent = `${symbol(t)} · ${precision(t)} decimal places · #${t.id}`;
    } catch (error) { if (el.value === requested) info.textContent = error.message; }
  }
});
$('#account').value = state.account;
if (!$('#account').value) { state.account = 'alice'; $('#account').value = 'alice'; }
$('#account').addEventListener('change', () => { state.account = $('#account').value; localStorage.setItem('relay-account', state.account); state.data = null; refresh(); });
$('#market-select').addEventListener('change', () => selectMarket($('#market-select').value));
$('#refresh').addEventListener('click', refresh);
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#modal').close(); } });
document.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.classList.contains('book-row')) event.target.click(); });
$('#connection-banner').hidden = false;
refresh();
setInterval(() => { if (!state.pending && !state.fetches && !document.hidden) refresh(); }, 4000);
