import { atoms, decimal, integer, committed as commit, priceTick, priceText, relayOutput, relayPrice, safeText as esc, ceilDiv } from './amounts.js';
import { creditStatus, fundingPaused } from './market-policy.js';
import { depthRows, orderSpread, quoteForSize, maximumBidSize, unitsFromAmount, ownershipForDeposit, ownershipForWithdrawal, tradePriceAtoms } from './order-book.js';
import { candlesFromTrades, depthBounds } from './market-chart.js';
import { walletApiBase } from './config.js';
const API_BASE=walletApiBase(location.href);
const PROFILE=new URLSearchParams(location.search).get('profile')==='1';
const profile=(kind,metrics)=>{if(PROFILE)console.debug('[exchange-profile]',JSON.stringify({kind,...metrics}));};

const $ = selector => document.querySelector(selector);
const state = { account: localStorage.getItem('relay-account') || 'alice', market: null, data: null, side: 'buy', type: 'market', ticket: 'spot', orderTab: 'orders', pending: false, online: false, activity: [], refresh: 0, fetches: 0, chart: 'price', interval: 5, depthRange: 2, bookView: 'orders', trades: new Map(), tradeRequests: new Set() };
let toastTimer;
let previousDepth = new Map();
let previousChartSignature='';
let previousTapeSignature='';
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
    if (g && g.active === false && m && !fundingPaused(m) && key(g.long ? m.quote : m.base) === key(id)) amount += g.claimable_surplus!==undefined?value(g.claimable_surplus):value(p.units) * value(g.original_surplus) / (value(g.original_units) || 1n);
  }
  return amount;
}

async function api(path, body) {
  const started=PROFILE?performance.now():0;
  const response = await fetch(`${API_BASE}${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const received=PROFILE?performance.now():0;
  let data;
  try {
    if(PROFILE){const text=await response.text();data=JSON.parse(text);const decoded=performance.now();profile('api',{path,status:response.status,bytes:new TextEncoder().encode(text).byteLength,fetchMs:+(received-started).toFixed(2),decodeMs:+(decoded-received).toFixed(2),totalMs:+(decoded-started).toFixed(2)});}
    else data = await response.json();
  } catch { throw new Error(`The local chain bridge returned HTTP ${response.status}.`); }
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
    if (market() && !$('#trade-view').hidden) loadTrades(market().id);
  } catch (error) {
    state.online = false;
    $('#connection-banner').textContent = `Local chain unavailable: ${error.message} Retrying automatically.`;
    $('#connection-banner').hidden = false;
    $('#chain-status').innerHTML = '<i></i> Reconnecting';
    $('#chain-status').className = 'offline';
    if (!state.data) $('#orders-content').innerHTML = empty('Connecting to your exchange', 'The interface reads live native chain state.');
  } finally { state.fetches--; }
}
async function loadTrades(id) {
  const request = key(id);
  if (state.tradeRequests.has(request)) return;
  state.tradeRequests.add(request);
  try {
    const cached=state.trades.get(request);
    const after=cached?.[0]?.event_id;
    const afterQuery=after?`&after=${encodeURIComponent(after)}`:'';
    let data = await api(`/api/trades?market=${encodeURIComponent(request)}&limit=100${afterQuery}`);
    const incoming=[...(data.trades||[])];
    const supportsDelta=!after||(data.trades||[]).every(t=>value(t.event_id)>value(after));
    for(let page=1;page<5&&data.next_before&&(!cached||supportsDelta);page++){
      data=await api(`/api/trades?market=${encodeURIComponent(request)}&limit=100&before=${encodeURIComponent(data.next_before)}${afterQuery}`);
      incoming.push(...(data.trades||[]));
    }
    const merged=new Map((state.trades.get(request)||[]).map(t=>[key(t.event_id),t]));
    for(const trade of incoming)merged.set(key(trade.event_id),trade);
    state.trades.set(request,[...merged.values()].sort((a,b)=>value(a.event_id)>value(b.event_id)?-1:1).slice(0,2000));
    if (key(state.market) === request) { if(state.chart==='price')renderChart(); renderTape(); }
  } catch { /* Existing native order and balance state remains usable. */ }
  finally { state.tradeRequests.delete(request); }
}

function render() {
  const started=PROFILE?performance.now():0;
  renderState();
  if(PROFILE)profile('render',{durationMs:+(performance.now()-started).toFixed(2)});
}
function renderState() {
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
    $('#depth-chart').innerHTML = '<div class="chart-empty">Supply liquidity to create the first market.</div>';
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
  const spread = orderSpread(levels(m), m);
  $('#ticker-levels').textContent = spread ? `${price(spread.ticks, m)} ${symbol(q)}` : '—';
  $('#pair-subtitle').textContent = `Min ${fmt(m.base_lot, b)} ${symbol(b)} · price step ${price(1n, m)} ${symbol(q)}`;
  $('#pair-subtitle').title = `Market #${m.id}: minimum order size ${fmt(m.base_lot, b)} ${symbol(b)}, price increment ${price(1n, m)} ${symbol(q)}.`;
  const credit = creditStatus(m);
  $('#market-mode').textContent = credit.label;
  $('#market-mode').className = `market-mode ${credit.enabled ? 'enabled' : fundingPaused(m) ? 'paused' : 'spot-only'}`;
  $('#market-mode').title = credit.reason || 'This book was funded with tokens eligible for protected margin lending.';
  if (!$('#ticket-content').dataset.ready || (state.ticket === 'margin' && $('#ticket-content').dataset.credit !== String(credit.enabled))) renderTicket();
  renderBook(); renderChart(); renderOrders(); renderEarn(); updateEstimates();
}

function renderBook() {
  const m = market(); const { b, q } = assets(m);
  const nextDepth = new Map();
  for (const bid of [false, true]) {
    let rows = depthRows(levels(m), m, bid, 14);
    const total = rows.at(-1)?.totalBase || 1n;
    if (!bid) rows.reverse();
    const content = rows.map(l => {
      const id = `${m.id}:${bid}:${l.price}`;
      const before = previousDepth.get(id);
      nextDepth.set(id, l.size);
      const change = before !== undefined && before !== l.size ? (l.size > before ? 'depth-added' : 'depth-reduced') : '';
      const depth = String(l.totalBase * 10000n / total / 100n);
      return `<div class="book-row ${change}" style="--depth:${depth}%" data-price="${esc(l.price)}" tabindex="0" role="button" aria-label="Set limit price ${esc(price(l.price))}" title="Cumulative depth: ${esc(fmt(l.totalBase, b))} ${esc(symbol(b))}"><span>${esc(price(l.price))}</span><span>${esc(fmt(l.size, b, 6))}</span><span>${esc(fmt(l.totalQuote, q, 2))}</span></div>`;
    }).join('');
    $(bid ? '#bids' : '#asks').innerHTML = content || `<div class="empty-book"><strong>No open ${bid ? 'buy' : 'sell'} orders</strong><span>Market maker liquidity is available.</span></div>`;
  }
  previousDepth = nextDepth;
  const spread = orderSpread(levels(m), m);
  $('#book-spread').textContent = spread ? `${price(spread.ticks)} ${symbol(q)} · ${decimal(spread.percentScaled, 4, 4)}%` : '—';
  renderTape();
}
function renderTape() {
  if (!market()) return;
  $('#recent-trades').hidden = state.bookView !== 'trades';
  for (const selector of ['.book-columns', '#asks', '.book-mid', '.book-spread', '#bids', '.book-foot']) $(selector).hidden = state.bookView === 'trades';
  if(state.bookView!=='trades')return;
  const { b, q } = assets(market());
  const trades = state.trades.get(key(state.market)) || [];
  const signature=`${state.market}:${trades[0]?.event_id}:${trades.length}:${b.id}:${q.id}`;
  if(signature===previousTapeSignature)return;
  previousTapeSignature=signature;
  $('#recent-trades').innerHTML = `<div class="trade-columns"><span>Price ${esc(symbol(q))}</span><span>Size ${esc(symbol(b))}</span><span>Time</span></div>${trades.slice(0, 35).map(t => {
    const p = tradePriceAtoms(t, precision(b)); if (p === null) return '';
    const time = new Date(t.time);
    return `<div class="trade-print"><span class="${t.sell_base ? 'side-sell' : 'side-buy'}">${esc(decimal(p, precision(q), Math.min(precision(q), 2)))}</span><span>${esc(fmt(t.base_amount, b, 6))}</span><time>${esc(Number.isNaN(time.valueOf()) ? `#${t.block_num}` : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</time></div>`;
  }).join('')}${trades.length ? '' : empty('No trades yet', 'Completed trades will appear here.', '↗')}`;
}
function renderChart() {
  const started=PROFILE?performance.now():0;
  const changed=drawChart();
  if(PROFILE)profile('chart',{view:state.chart,changed:Boolean(changed),durationMs:+(performance.now()-started).toFixed(2)});
}
function drawChart() {
  const m = market(); const { b, q } = assets(m);
  if($('#trade-view').hidden)return;
  $('#chart-heading').textContent = state.chart === 'price' ? `${symbol(b)} / ${symbol(q)}` : 'Market depth';
  $('#chart-subtitle').textContent = state.chart === 'price' ? 'Recent trading prices' : 'Cumulative buy and sell liquidity';
  document.querySelector('.curve-label').textContent = state.chart === 'price' ? '' : 'BUY / SELL DEPTH';
  $('#depth-controls').hidden=state.chart!=='depth';$('#candle-resolution').hidden=state.chart!=='price';
  const foot=document.querySelectorAll('.chart-foot span');foot[0].textContent=state.chart==='price'?'':`−${state.depthRange}%`;foot[1].textContent=state.chart==='price'?'Recent trades':'Cumulative liquidity';foot[2].textContent=state.chart==='price'?'':`+${state.depthRange}%`;
  const rect=$('#depth-chart').getBoundingClientRect(),history=state.trades.get(key(m.id))||[];
  const signature=state.chart==='price'?`${m.id}:price:${state.interval}:${history[0]?.event_id}:${history.length}:${rect.width}:${rect.height}`:`${m.id}:depth:${state.depthRange}:${m.x}:${m.y}:${m.k}:${levels(m).map(l=>`${l.bid}:${l.price}:${l.outgoing}`).join(',')}:${rect.width}:${rect.height}`;
  if(signature===previousChartSignature)return;
  previousChartSignature=signature;
  if (state.chart === 'price') { renderPriceChart(m, b, q); return true; }
  const x = value(m.x), y = value(m.y), k = value(m.k);
  if (!x || !y || !k) return;
  // SVG geometry only: no plotted Number is ever used for a transaction.
  const box=$('#depth-chart').getBoundingClientRect();
  const W = Math.max(280,box.width-17), H = Math.max(210,box.height), left = 60, right = W - 22, top = 15, bottom = H - 29;
  const mid = Number(y) / Number(x) * 10 ** (precision(b) - precision(q));
  const {low,high}=depthBounds(mid,state.depthRange);
  const nativePrices = levels(m).map(l => Number(value(l.price) * value(m.quote_tick)) / Number(value(m.base_lot)) * 10 ** (precision(b) - precision(q))).filter(p=>p>=low&&p<=high);
  const range = high - low;
  const px = p => left + (p - low) / range * (right - left);
  const py = n => bottom - n * (bottom - top);
  const bids = [], asks = [];
  const bidPrices = [...new Set([mid, low, ...nativePrices.filter(p => p < mid), ...Array.from({length:49},(_,i)=>mid-(mid-low)*i/48)])].sort((a,b)=>b-a);
  const askPrices = [...new Set([mid, high, ...nativePrices.filter(p => p > mid), ...Array.from({length:49},(_,i)=>mid+(high-mid)*i/48)])].sort((a,b)=>a-b);
  for (const priceLow of bidPrices) {
    const sell = Math.sqrt(Number(k) / (priceLow / 10 ** (precision(b) - precision(q)))) - Number(x);
    const resting = levels(m).filter(l=>l.bid && Number(value(l.price)*value(m.quote_tick))/Number(value(m.base_lot))*10**(precision(b)-precision(q)) >= priceLow).reduce((sum,l)=>sum+Number(value(l.outgoing)/(value(l.price)*value(m.quote_tick))*value(m.base_lot)),0);
    bids.push({ p: priceLow, amount: Math.max(0, sell) + resting });
  }
  for (const priceHigh of askPrices) {
    const buy = Number(x) - Math.sqrt(Number(k) / (priceHigh / 10 ** (precision(b) - precision(q))));
    const resting = levels(m).filter(l=>!l.bid && Number(value(l.price)*value(m.quote_tick))/Number(value(m.base_lot))*10**(precision(b)-precision(q)) <= priceHigh).reduce((sum,l)=>sum+Number(value(l.outgoing)/value(m.base_lot)*value(m.base_lot)),0);
    asks.push({ p: priceHigh, amount: Math.max(0, buy) + resting });
  }
  const max = Math.max(bids.at(-1).amount, asks.at(-1).amount, 1);
  const path = points => points.map((v, i) => `${i ? 'L' : 'M'}${px(v.p).toFixed(2)},${py(v.amount / max).toFixed(2)}`).join(' ');
  const bidPath = path(bids), askPath = path(asks);
  const maximumUnits = max / 10 ** precision(b);
  const axisDecimals = Math.min(precision(b), maximumUnits < .001 ? 8 : maximumUnits < 1 ? 6 : 3);
  const grid = [.25, .5, .75, 1].map(v => `<line x1="${left}" x2="${right}" y1="${py(v)}" y2="${py(v)}" stroke="#223044" stroke-dasharray="2 5"/><text x="${left - 8}" y="${py(v) + 3}" fill="#627994" font-size="9" text-anchor="end">${(max * v / 10 ** precision(b)).toLocaleString(undefined, { maximumFractionDigits: axisDecimals })}</text>`).join('');
  const labels = [low, (low+mid)/2, mid, (mid+high)/2, high].map((p,i) => `<text x="${px(p)}" y="${H - 7}" fill="#7187a1" font-size="9" text-anchor="${i===0?'start':i===4?'end':'middle'}">${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}</text>`).join('');
  $('#depth-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Current buy and sell market depth"><defs><linearGradient id="bidFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#33d4a3" stop-opacity=".21"/><stop offset="1" stop-color="#33d4a3" stop-opacity=".015"/></linearGradient><linearGradient id="askFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f47888" stop-opacity=".19"/><stop offset="1" stop-color="#f47888" stop-opacity=".015"/></linearGradient></defs>${grid}<path d="${bidPath} L${px(low)},${bottom} L${px(mid)},${bottom} Z" fill="url(#bidFill)"/><path d="${askPath} L${px(high)},${bottom} L${px(mid)},${bottom} Z" fill="url(#askFill)"/><path d="${bidPath}" stroke="#33d4a3" fill="none" stroke-width="2"/><path d="${askPath}" stroke="#f47888" fill="none" stroke-width="2"/><line x1="${px(mid)}" x2="${px(mid)}" y1="${top}" y2="${bottom}" stroke="#4e6685" stroke-dasharray="3 5"/><line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="#2d3d52"/>${labels}<text x="${left}" y="8" fill="#627994" font-size="8">${esc(symbol(b))}</text></svg>`;
  return true;
}
function renderPriceChart(m, b, q) {
  const candles=candlesFromTrades(state.trades.get(key(m.id))||[],precision(b),state.interval,60);
  if(!candles.length){$('#depth-chart').innerHTML=`<div class="chart-empty">${state.trades.has(key(m.id))?'No trades in this market yet.':'Loading chart…'}</div>`;return;}
  const box=$('#depth-chart').getBoundingClientRect();
  const W=Math.max(280,box.width-17),H=Math.max(210,box.height),left=65,right=W-22,top=15,volumeBottom=H-33,bottom=top+(volumeBottom-top)*.73,volumeTop=bottom+13;
  const scale=10**precision(q),lo=Math.min(...candles.map(c=>Number(c.low)/scale)),hi=Math.max(...candles.map(c=>Number(c.high)/scale));
  const pad=Math.max((hi-lo)*.12,hi*.00002),low=lo-pad,high=hi+pad;
  const interval=state.interval*1000,first=candles[0].time-interval/2,last=candles.at(-1).time+interval/2;
  const px=time=>left+(time-first)/(last-first)*(right-left),py=p=>bottom-(p-low)/(high-low)*(bottom-top);
  const width=Math.max(2,Math.min(18,(right-left)/((last-first)/interval)*.66));
  const lines=[0,.25,.5,.75,1].map(f=>{const p=low+(high-low)*f,y=py(p);return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#223044" stroke-dasharray="2 5"/><text x="${left-8}" y="${y+3}" text-anchor="end" font-size="9" fill="#7187a1">${p.toLocaleString(undefined,{maximumFractionDigits:2})}</text>`;}).join('');
  const bodies=candles.map(c=>{const x=px(c.time),o=Number(c.open)/scale,h=Number(c.high)/scale,l=Number(c.low)/scale,close=Number(c.close)/scale,color=c.close>=c.open?'#33d4a3':'#f47888',y=Math.min(py(o),py(close)),height=Math.max(1.5,Math.abs(py(o)-py(close)));return `<g><title>${esc(new Date(c.time).toLocaleTimeString())} · O ${esc(fmt(c.open,q))} H ${esc(fmt(c.high,q))} L ${esc(fmt(c.low,q))} C ${esc(fmt(c.close,q))}</title><line x1="${x}" x2="${x}" y1="${py(h)}" y2="${py(l)}" stroke="${color}" stroke-width="1.2"/><rect x="${x-width/2}" y="${y}" width="${width}" height="${height}" rx=".6" fill="${color}"/></g>`;}).join('');
  const labels=[0,.5,1].map(f=>{const time=first+(last-first)*f;return `<text x="${left+(right-left)*f}" y="${H-9}" fill="#7187a1" font-size="9" text-anchor="${f===0?'start':f===1?'end':'middle'}">${esc(new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</text>`;}).join('');
  const close=Number(candles.at(-1).close)/scale;
  const maxVolume=candles.reduce((maximum,c)=>c.volume>maximum?c.volume:maximum,1n);
  const volumeBars=candles.map(c=>{const height=Number(c.volume)/Number(maxVolume)*(volumeBottom-volumeTop),color=c.close>=c.open?'#33d4a3':'#f47888';return `<rect x="${px(c.time)-width/2}" y="${volumeBottom-height}" width="${width}" height="${Math.max(1,height)}" fill="${color}" opacity=".33"><title>${esc(fmt(c.volume,b))} ${esc(symbol(b))}</title></rect>`;}).join('');
  const volumeAxis=`<line x1="${left}" x2="${right}" y1="${volumeTop}" y2="${volumeTop}" stroke="#223044"/><text x="${left-8}" y="${volumeTop+8}" text-anchor="end" font-size="8" fill="#7187a1">${esc(fmt(maxVolume,b,6))}</text><text x="${left+5}" y="${volumeTop+10}" font-size="8" fill="#7187a1">Volume ${esc(symbol(b))}</text>`;
  $('#depth-chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${state.interval}-second trading candlesticks">${lines}<line x1="${left}" x2="${right}" y1="${py(close)}" y2="${py(close)}" stroke="#7187a1" stroke-dasharray="3 5" opacity=".5"/>${bodies}${volumeAxis}${volumeBars}${labels}</svg>`;
}

function renderTicket() {
  if (!market()) return;
  const m = market(); const { b, q } = assets(m);
  const sell = state.side === 'sell'; const input = state.type==='limit'?b:(sell ? b : q);
  $('#ticket-content').dataset.ready = '1';
  const credit = creditStatus(m);
  $('#ticket-content').dataset.credit = String(credit.enabled);
  if (state.ticket === 'margin' && !credit.enabled) {
    $('#ticket-content').innerHTML = `<div class="ticket-body"><div class="credit-unavailable"><span>◇</span><h3>${esc(credit.label)}</h3><p>${esc(credit.reason)}</p><button type="button" class="button subtle" data-view="markets">Browse markets</button></div><p class="help-inline">You can still manage existing orders and repay existing positions below.</p></div>`;
    return;
  }
  if (state.ticket === 'margin') {
    $('#ticket-content').innerHTML = `<form id="margin-form" class="ticket-body"><div class="buy-sell-toggle"><button type="button" class="${!sell ? 'active' : ''}" data-side="buy">Long ${esc(symbol(b))}</button><button type="button" class="${sell ? 'active' : ''}" data-side="sell">Short ${esc(symbol(b))}</button></div><div class="available-row"><span>Collateral available</span><strong id="ticket-available">—</strong></div><label>Liquidation trigger price<div class="input-wrap"><input name="price" inputmode="decimal" placeholder="0.00" required><span>${esc(symbol(q))}</span></div></label><label>Collateral amount<div class="input-wrap"><input name="collateral" inputmode="decimal" required><span>${esc(symbol(sell?q:b))}</span></div></label><div id="order-estimate" class="estimate-box"></div><button type="submit" class="button ${sell ? 'sell' : 'buy'}">Borrow ${esc(symbol(sell ? b : q))}</button><p class="help-inline">Collateral remains reserved until repayment or liquidation. The financing charge is included in the amount owed.</p><button class="button ghost" type="button" data-action="liquidate" style="margin-top:15px">Process liquidations</button><button class="button ghost" type="button" data-action="renew" title="Start a new 30-day lending term after all debt is closed" style="margin-top:8px">Renew lending term</button></form>`;
    const spotPrice = value(m.y) * value(m.base_lot) / (value(m.x) * value(m.quote_tick));
    const suggested = spotPrice * (sell ? 120n : 80n) / 100n;
    $('#margin-form input[name=price]').value = price(suggested).replace(/,/g, '');
    $('#margin-form input[name=collateral]').value = decimal(sell?2n*suggested*value(m.quote_tick):2n*value(m.base_lot),precision(sell?q:b),precision(sell?q:b),false);
  } else {
    $('#ticket-content').innerHTML = `<form id="spot-form" class="ticket-body"><div class="buy-sell-toggle"><button type="button" class="${!sell ? 'active' : ''}" data-side="buy">Buy</button><button type="button" class="${sell ? 'active' : ''}" data-side="sell">Sell</button></div><div class="order-type"><button type="button" data-type="market" class="${state.type === 'market' ? 'active' : ''}">Market</button><button type="button" data-type="limit" class="${state.type === 'limit' ? 'active' : ''}">Limit</button></div><div class="available-row"><span>Available</span><strong id="ticket-available">—</strong></div>${state.type === 'limit' ? `<label>Limit price<div class="input-wrap"><input name="price" inputmode="decimal" placeholder="0.00" required><span>${esc(symbol(q))}</span></div></label>` : ''}<label>${state.type==='limit'?'Size':(sell ? 'Amount to sell' : 'Amount to spend')}<div class="input-wrap"><input name="amount" inputmode="decimal" placeholder="${precision(input) > 2 ? '0.00000000' : '0.00'}" required><span>${esc(symbol(input))}</span></div></label><div class="percentage-row">${[25, 50, 75, 100].map(n => `<button type="button" data-percent="${n}">${n}%</button>`).join('')}</div>${state.type === 'market' ? '<label>Slippage limit<div class="input-wrap"><input name="slippage" inputmode="decimal" value="1.00" required><span>%</span></div></label>' : ''}<div id="order-estimate" class="estimate-box"></div><button type="submit" class="button ${sell ? 'sell' : 'buy'}">${sell ? 'Sell' : 'Buy'} ${esc(symbol(b))}</button><p class="help-inline">${state.type === 'limit' ? 'A limit order executes at your price or better. You can cancel its remaining amount at any time.' : 'Your order executes against available buy and sell liquidity. Your minimum receive amount is protected.'}</p></form>`;
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
      const form = $('#margin-form'); const p = priceTick(form.elements.price.value, m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) }); const cUnit=sell?2n*p*value(m.quote_tick):2n*value(m.base_lot); const collateral=atoms(form.elements.collateral.value,precision(sell?q:b),'Collateral'); const units=unitsFromAmount(collateral,cUnit,'Collateral');
      const face = units * (sell ? value(m.base_lot) : p * value(m.quote_tick));
      const coll = units * (sell ? 2n * p * value(m.quote_tick) : 2n * value(m.base_lot));
      const feeUnit = ceilDiv((sell ? value(m.base_lot) : p * value(m.quote_tick)) * value(m.fee_bps ?? state.data.fee_bps ?? 100), 10000n);
      const advance = face - feeUnit * units;
      area.innerHTML = estimateLine('Collateral locked', `${fmt(coll, sell ? q : b)} ${symbol(sell ? q : b)}`) + estimateLine('You receive', `${fmt(advance, sell ? b : q)} ${symbol(sell ? b : q)}`) + estimateLine('Amount owed', `${fmt(face, sell ? b : q)} ${symbol(sell ? b : q)}`) + estimateLine('Coverage', 'Collateral checked on chain') + (m.maturity ? estimateLine('Credit maturity', new Date(Number(m.maturity) * 1000).toLocaleDateString()) : '');
    } else {
      const form = $('#spot-form'); const amount = atoms(form.elements.amount.value || '0', precision(state.type==='limit'?b:input), 'Amount', true);
      let expected;
      if (state.type === 'limit') {
        const p = priceTick(form.elements.price.value, m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) });
        const total = amount ? quoteForSize(amount,p,m) : 0n;
        area.innerHTML=estimateLine('Order value',`${fmt(total,q)} ${symbol(q)}`)+estimateLine('Size',`${fmt(amount,b)} ${symbol(b)}`)+estimateLine('Trading fee','0%');
        updateLiquidityPreview(); return;
      } else expected = relayOutput(m, sell, amount);
      const slip = state.type === 'market' ? atoms(form.elements.slippage.value || '0', 2, 'Slippage', true) : 0n;
      if (slip > 5000n) throw new Error('Slippage must be 50% or less.');
      const minimum = expected * (10000n - slip) / 10000n;
      area.innerHTML = estimateLine(state.type === 'market' ? 'Estimated receive' : 'At full execution', `${fmt(expected, output)} ${symbol(output)}`) + (state.type === 'market' ? estimateLine('Minimum receive', `${fmt(minimum, output)} ${symbol(output)}`) : '') + estimateLine('Settlement', 'Psibase · atomic') + estimateLine('Trading fee', '0%');
    }
  } catch (error) { area.innerHTML = `<span class="subtext">${esc(error.message)}</span>`; }
  updateLiquidityPreview();
}

function renderOrders() {
  const m = market(); const { b, q } = assets(m);
  const positions = (state.data.positions || []).filter(p => own(p) && sameMarket(p) && value(p.remaining_outgoing ?? p.refund)>0n);
  const loans = (state.data.loan_positions || []).filter(p => own(p) && sameMarket(p) && (state.data.loans||[]).some(g=>key(g.generation??g.id)===key(p.generation)&&g.active===true));
  $('#order-count').textContent = String(positions.length); $('#loan-count').textContent = String(loans.length);
  let html;
  if (state.orderTab === 'activity') {
    html = state.activity.length ? state.activity.map(a => `<div class="activity-item"><span>✓</span><div>${esc(a.label)}<small>${esc(a.id ? a.id.slice(0, 28) + '…' : 'Confirmed on the local chain')}</small></div><time>${esc(a.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time></div>`).join('') : empty('Your transactions, confirmed', 'Actions from this session will appear here.', '↗');
  } else if (state.orderTab === 'loans') {
    html = loans.length ? `<table class="data-table"><thead><tr><th>Position</th><th>Liquidation price</th><th>Amount owed</th><th>Collateral</th><th></th></tr></thead><tbody>${loans.map(p => {
      const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation)); if (!g) return '';
      const active = g.active !== false; const long = Boolean(g.long); const debtAsset = long ? q : b;
      const debt = active ? value(p.units) * value(g.face_unit) : value(p.units) * value(g.original_surplus ?? g.surplus) / (value(g.original_units) || 1n);
      const collateralAsset=long?b:q;
      return `<tr><td><span class="${long ? 'side-buy' : 'side-sell'}">${long ? 'Long' : 'Short'} ${esc(symbol(b))}</span></td><td>${esc(price(p.price ?? g.price))}</td><td>${esc(fmt(active?debt:0n, debtAsset))} ${esc(symbol(debtAsset))}${active ? '' : `<br><small>${esc(fmt(debt,debtAsset))} ${esc(symbol(debtAsset))} proceeds</small>`}</td><td>${active?`${esc(fmt(value(p.units)*value(g.collateral_unit),collateralAsset))} ${esc(symbol(collateralAsset))}`:'Released'}</td><td><button class="button small ${active ? 'subtle' : 'primary'}" data-position-action="${active ? 'repay' : 'claim'}" data-long="${long}" data-price="${esc(p.price ?? g.price)}" data-units="${esc(p.units)}" data-face="${esc(g.face_unit)}">${active ? 'Repay' : 'Close'}</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('No margin positions', 'Open a position from the Margin tab.', '◇');
  } else {
    html = positions.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Price</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody>${positions.map(p => {
      const remaining=value(p.remaining_outgoing??p.refund);
      const baseRemaining=p.remaining_base!==undefined?value(p.remaining_base):(p.bid?remaining*value(m.base_lot)/(value(p.price)*value(m.quote_tick)):remaining);
      const remainder=p.active===false;
      const amountText=baseRemaining>0n?`${fmt(baseRemaining,b)} ${symbol(b)}`:`${fmt(remaining,p.bid?q:b)} ${symbol(p.bid?q:b)}`;
      return `<tr><td><span class="${p.bid ? 'side-buy' : 'side-sell'}">${p.bid ? 'Buy' : 'Sell'} ${esc(symbol(b))}</span></td><td>${esc(price(p.price))}</td><td>${esc(amountText)}</td><td><span class="order-status">${remainder?'Remainder':'Open'}</span></td><td><button class="button small subtle" data-position-action="cancel" data-bid="${Boolean(p.bid)}" data-price="${esc(p.price)}">Cancel</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('Your orders will appear here', 'Place a limit order at your chosen price.', '≋');
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
    return `<tr><td><div class="asset-name">${coin(t)}<div><strong>${esc(name)}</strong><small>Native token #${esc(t.id)}</small></div></div></td><td>${esc(fmt(row.wallet, t))}</td><td>${esc(fmt(available(t.id), t))}</td><td class="committed-amount" title="Funds reserved for orders and margin collateral">${esc(fmt(committed(t.id), t))}</td><td><div class="balance-buttons"><button class="button ghost" data-funds="deposit" data-token="${esc(t.id)}">Deposit</button><button class="button ghost" data-funds="withdraw" data-token="${esc(t.id)}">Withdraw</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">No native tokens found.</td></tr>';
}
function renderMarketList() {
  $('#market-list').innerHTML = (state.data.markets || []).map(m => {
    const { b, q } = assets(m);
    const credit = creditStatus(m);
    return `<tr><td><div class="asset-name">${coin(b)}<div><strong>${esc(symbol(b))} / ${esc(symbol(q))} · #${esc(m.id)} <span class="market-mode ${credit.enabled ? 'enabled' : 'spot-only'}">${esc(credit.label)}</span></strong><small>Min ${esc(fmt(m.base_lot, b))} ${esc(symbol(b))} · price step ${esc(price(1n, m))} ${esc(symbol(q))}</small></div></div></td><td>${esc(relayPrice(m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) }))}</td><td>${esc(fmt(m.x, b))} ${esc(symbol(b))}</td><td>${esc(fmt(m.y, q))} ${esc(symbol(q))}</td><td>${orderSpread(levels(m),m) ? esc(price(orderSpread(levels(m),m).ticks,m)) : "—"}</td><td><button class="button small subtle" data-select-market="${esc(m.id)}">Trade →</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:35px;color:var(--muted)">Supply liquidity to create the first market.</td></tr>';
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
  $('#liquidity-token').textContent=symbol(b);
  $('#relay-stats').innerHTML = `<div class="relay-summary"><div class="stat-cell"><small>${esc(symbol(b))} reserve</small><strong>${esc(fmt(m.x, b, 5))}</strong></div><div class="stat-cell"><small>${esc(symbol(q))} reserve</small><strong>${esc(fmt(m.y, q, 2))}</strong></div></div>`;
  const lenders = (state.data.lenders || []).filter(p => own(p) && sameMarket(p) && value(p.shares));
  $('#lender-positions').innerHTML = lenders.length ? lenders.map(p => {
    const base = Boolean(p.base); const t = base ? b : q;
    const supply = value(base ? m.lending_base : m.lending_quote) || 1n;
    const nav = value(base ? m.vault_base : m.vault_quote) + value(base ? m.debt_base : m.debt_quote);
    return `<div class="position-item"><div>${esc(fmt(value(p.shares) * nav / supply, t))} ${esc(symbol(t))}<small>Your lending balance</small></div><button class="button small subtle" data-position-action="unlend" data-base="${base}" data-shares="${esc(p.shares)}">Withdraw</button></div>`;
  }).join('') : '<span class="subtext">You have no lending balance in this market.</span>';
  const position = (state.data.relay_shares || []).find(p => own(p) && sameMarket(p));
  $('#relay-position').innerHTML = position && value(position.shares) ? `<div class="position-item"><div>${esc(fmt(value(position.shares)*value(m.x)/value(m.lp_supply),b))} ${esc(symbol(b))}<small>+ ${esc(fmt(value(position.shares)*value(m.y)/value(m.lp_supply),q))} ${esc(symbol(q))} supplied</small></div><button class="button small subtle" data-position-action="remliq" data-shares="${esc(position.shares)}">Remove</button></div>` : '<span class="subtext">You have no market-making liquidity in this market.</span>';
}
function updateLiquidityPreview() {
  const m = market(); if (!m) return;
  const { b, q } = assets(m);
  try {
    const baseAmount = atoms($('#liquidity-form input[name=amount]').value || '0', precision(b), 'Amount', true);
    const shares = ownershipForDeposit(baseAmount, m);
    const supply = value(m.lp_supply) || 1n;
    $('#liquidity-preview').innerHTML = estimateLine('Required base', `${fmt(ceilDiv(shares * value(m.x), supply), b)} ${symbol(b)}`) + estimateLine('Required quote', `${fmt(ceilDiv(shares * value(m.y), supply), q)} ${symbol(q)}`);
  } catch (error) { $('#liquidity-preview').textContent = error.message; }
}

function showFunds(mode, id) {
  const t = token(id); const deposit = mode === 'deposit';
  $('#modal-title').textContent = `${deposit ? 'Deposit' : 'Withdraw'} ${symbol(t)}`;
  $('#modal-content').innerHTML = `<form id="funds-form" class="modal-form" data-mode="${mode}" data-token="${esc(id)}"><div class="asset-action-note">${deposit ? 'Move funds from your wallet to your available trading balance.' : 'Return available funds to your wallet. Cancel orders or repay loans to release reserved funds first.'}</div><label>Amount<div class="input-wrap"><input name="amount" inputmode="decimal" placeholder="0.00" required autofocus><span>${esc(symbol(t))}</span></div></label><div class="estimate-line"><span>${deposit ? 'Wallet balance' : 'Available to withdraw'}</span><strong>${esc(fmt(deposit ? balance(id).wallet : available(id), t))} ${esc(symbol(t))}</strong></div><button class="button primary" type="submit">${deposit ? 'Deposit' : 'Withdraw'} ${esc(symbol(t))}</button></form>`;
  $('#modal').showModal();
}
function showCreate() {
  const options = (state.data?.tokens || []).map(t => `<option value="${esc(t.id)}">${esc(symbol(t))} · native token #${esc(t.id)}</option>`).join('');
  const current = market();
  const base = current ? token(current.base) : state.data?.tokens?.[0];
  const quote = current ? token(current.quote) : state.data?.tokens?.find(t => key(t.id) !== key(base?.id));
  $('#modal-title').textContent = 'Create a new market';
  $('#modal-content').innerHTML = `<form id="create-form" class="modal-form"><div class="asset-action-note">Choose two assets and supply the initial buy and sell liquidity. You can create an independent market even when the same pair is already listed.</div><datalist id="native-token-options">${options}</datalist><div class="row"><label>Base token ID<input name="base" inputmode="numeric" list="native-token-options" value="${esc(base?.id || '')}" required><small id="create-base-info">${esc(base ? `${symbol(base)} · ${precision(base)} decimal places` : 'Enter any native token ID')}</small></label><label>Quote token ID<input name="quote" inputmode="numeric" list="native-token-options" value="${esc(quote?.id || '')}" required><small id="create-quote-info">${esc(quote ? `${symbol(quote)} · ${precision(quote)} decimal places` : 'Enter any native token ID')}</small></label></div><div class="row"><label>Base reserve<input name="base_amount" inputmode="decimal" placeholder="1.0" required></label><label>Quote reserve<input name="quote_amount" inputmode="decimal" placeholder="100.0" required></label></div><div class="row"><label>Minimum order size<input name="min_size" inputmode="decimal" value="${esc(base?fmt(current?.base_lot||10000,base).replace(/,/g,''):'0.0001')}" required></label><label>Price increment<input name="price_step" inputmode="decimal" value="${esc(current?price(1n,current).replace(/,/g,''):'1')}" required></label></div><p class="small-note" style="padding:0">Both assets must be available in your trading balance. You set the starting price with the amounts you supply. Margin is available when the selected assets are eligible.</p><button class="button primary" type="submit">Create market</button></form>`;
  $('#modal').showModal();
}
function showShares(action, data) {
  const m=market(),{b,q}=assets(m),base=data.base==='true',t=base?b:q;
  const supply=value(base?m.lending_base:m.lending_quote),nav=value(base?m.vault_base:m.vault_quote)+value(base?m.debt_base:m.debt_quote);
  const maximum=action==='unlend'?value(data.shares)*nav/(supply||1n):0n;
  $('#modal-title').textContent = action === 'remliq' ? 'Remove liquidity' : `Withdraw ${symbol(t)}`;
  $('#modal-content').innerHTML = `<form id="shares-form" class="modal-form" data-method="${action}" data-base="${esc(data.base ?? '')}" data-owned="${esc(data.shares)}"><div class="asset-action-note">${action === 'remliq' ? 'Choose the portion of your supplied liquidity to remove. Outstanding loans must remain fully backed.' : 'Withdrawals use available cash. Funds lent to borrowers become available when loans are repaid.'}</div><label>${action==='remliq'?'Portion to remove':'Amount to withdraw'}<div class="input-wrap"><input name="amount" inputmode="decimal" value="${action==='remliq'?'100':decimal(maximum,precision(t),precision(t),false)}" required><span>${action==='remliq'?'%':esc(symbol(t))}</span></div></label><div id="withdraw-estimate" class="estimate-box"></div><button class="button primary" type="submit">${action === 'remliq' ? 'Remove liquidity' : 'Withdraw'}</button></form>`;
  updateWithdrawalPreview();
  $('#modal').showModal();
}
function withdrawalOwnership(form) {
  const m=market(),{b,q}=assets(m);
  if(form.dataset.method==='remliq') {
    const percent=atoms(form.elements.amount.value,2,'Percentage');
    if(percent>10000n)throw new Error('Choose a percentage up to 100%.');
    const owned=value(form.dataset.owned)*percent/10000n;
    if(!owned)throw new Error('This amount is too small to withdraw.');
    return owned;
  }
  const base=form.dataset.base==='true',t=base?b:q;
  return ownershipForWithdrawal(atoms(form.elements.amount.value,precision(t)),form.dataset.owned,base?m.lending_base:m.lending_quote,value(base?m.vault_base:m.vault_quote)+value(base?m.debt_base:m.debt_quote));
}
function updateWithdrawalPreview() {
  const form=$('#shares-form');if(!form)return;
  const m=market(),{b,q}=assets(m);
  try {
    const owned=withdrawalOwnership(form);
    if(form.dataset.method==='remliq')$('#withdraw-estimate').innerHTML=estimateLine('You receive',`${fmt(owned*value(m.x)/value(m.lp_supply),b)} ${symbol(b)}`)+estimateLine('Plus',`${fmt(owned*value(m.y)/value(m.lp_supply),q)} ${symbol(q)}`);
    else {const base=form.dataset.base==='true',t=base?b:q;const supply=value(base?m.lending_base:m.lending_quote),nav=value(base?m.vault_base:m.vault_quote)+value(base?m.debt_base:m.debt_quote);$('#withdraw-estimate').innerHTML=estimateLine('You receive',`${fmt(owned*nav/supply,t)} ${symbol(t)}`);}
  }catch(error){$('#withdraw-estimate').textContent=error.message;}
}
function showRepay(data) {
  const m=market(),{b,q}=assets(m),t=data.long==='true'?q:b;
  $('#modal-title').textContent = 'Repay margin loan';
  $('#modal-content').innerHTML = `<form id="repay-form" class="modal-form" data-long="${esc(data.long)}" data-price="${esc(data.price)}" data-face="${esc(data.face)}"><div class="asset-action-note">Repay the amount owed and release collateral. The financing charge is included.</div><label>Amount to repay<div class="input-wrap"><input name="amount" inputmode="decimal" value="${decimal(value(data.units)*value(data.face),precision(t),precision(t),false)}" required><span>${esc(symbol(t))}</span></div></label><small>Repayment increment ${esc(fmt(data.face,t))} ${esc(symbol(t))}</small><button class="button primary" type="submit">Repay & release collateral</button></form>`;
  $('#modal').showModal();
}
function setView(view) {
  for (const name of ['trade', 'lend', 'markets']) $(`#${name}-view`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if(view==='trade'&&market()){renderChart();loadTrades(market().id);}
}
function selectMarket(id) {
  state.market = id; $('#ticket-content').dataset.ready = ''; render(); setView('trade');
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button,[data-price]'); if (!button) return;
  const d = button.dataset;
  if (d.view) setView(d.view);
  if (d.zoom) { state.depthRange=Math.max(.05,Math.min(25,state.depthRange*(d.zoom==='in'?.5:2))); $('#depth-range').value=String(state.depthRange); renderChart(); }
  if (d.chart) { state.chart = d.chart; document.querySelectorAll('[data-chart]').forEach(el=>el.classList.toggle('active',el===button)); renderChart(); }
  if (d.bookView) { state.bookView=d.bookView; document.querySelectorAll('[data-book-view]').forEach(el=>el.classList.toggle('active',el===button)); renderTape(); }
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
    let amount=available(t.id)*BigInt(d.percent)/100n;
    if(state.type==='limit'){const {b,q}=assets(m);const p=priceTick($('#spot-form input[name=price]').value,m,{...b,precision:precision(b)},{...q,precision:precision(q)});amount=state.side==='sell'?amount/value(m.base_lot)*value(m.base_lot):maximumBidSize(amount,p,m);$('#spot-form input[name=amount]').value=decimal(amount,precision(b),precision(b),false);}
    else $('#spot-form input[name=amount]').value = decimal(amount, precision(t), precision(t), false);
    updateEstimates();
  }
  if (d.price && !d.positionAction && button.classList.contains('book-row')) {
    state.ticket = 'spot'; state.type = 'limit'; renderTicket();
    document.querySelectorAll('[data-ticket]').forEach(el => el.classList.toggle('active', el.dataset.ticket === 'spot'));
    $('#spot-form input[name=price]').value = price(d.price).replace(/,/g, ''); updateEstimates();
  }
  if (d.action === 'liquidate') await transact('Process liquidations', 'liquidate', { market: key(state.market), max_events: 64 });
  if (d.action === 'renew') await transact('Renew lending term', 'renew', { market: key(state.market) });
  if (d.positionAction) {
    if (['remliq', 'unlend'].includes(d.positionAction)) showShares(d.positionAction, d);
    else if (d.positionAction === 'repay') showRepay(d);
    else await transact(d.positionAction === 'cancel' ? 'Cancel order' : 'Receive position proceeds', d.positionAction, { market: key(state.market), price: d.price, ...(d.positionAction === 'cancel' ? { bid: d.bid === 'true' } : { long: d.long === 'true' }) });
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
      if (state.type === 'limit') {const p=priceTick(f.get('price'),m,{...b,precision:precision(b)},{...q,precision:precision(q)});const size=atoms(f.get('amount'),precision(b),'Size');const total=quoteForSize(size,p,m);await transact('Place limit order','limit',{market:key(m.id),bid:!sell,price:String(p),amount:String(commit(sell?size:total))});}
      else {
        const amount=commit(atoms(f.get('amount'),precision(input)));
        const slip = atoms(f.get('slippage'), 2, 'Slippage', true); if (slip > 5000n) throw new Error('Slippage must be 50% or less.');
        const expected = relayOutput(m, sell, amount); const minimum = expected * (10000n - slip) / 10000n;
        if (minimum < 1n) throw new Error('Order is too small for a nonzero minimum output.');
        await transact(`${sell ? 'Sell' : 'Buy'} ${symbol(b)}`, 'trade', { market: key(m.id), sell_base: sell, amount: String(amount), min_output: String(minimum), max_events: 128 });
      }
    } else if (form.id === 'margin-form') {
      if (!creditStatus(m).enabled) throw new Error(creditStatus(m).reason);
      const long = state.side !== 'sell';
      const p = priceTick(f.get('price'), m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) });
      const collateral=atoms(f.get('collateral'),precision(long?b:q),'Collateral');
      const units=unitsFromAmount(collateral,long?2n*value(m.base_lot):2n*p*value(m.quote_tick),'Collateral');
      commit(units * (long ? 2n * value(m.base_lot) : 2n * p * value(m.quote_tick)), 'Loan collateral');
      commit(units * (long ? p * value(m.quote_tick) : value(m.base_lot)), 'Loan face debt');
      await transact('Open margin loan', 'borrow', { market: key(m.id), long, price: String(p), units: String(units) });
    }
    else if (form.id === 'lend-form') { if (!creditStatus(m).enabled) throw new Error(creditStatus(m).reason); const base = f.get('base') === 'true'; await transact('Supply lending vault', 'lend', { market: key(m.id), base, amount: String(commit(atoms(f.get('amount'), precision(base ? b : q)))) }); }
    else if (form.id === 'liquidity-form') await transact('Add relay liquidity', 'addliq', { market: key(m.id), shares: String(commit(ownershipForDeposit(atoms(f.get('amount'),precision(b)),m), 'Liquidity amount')) });
    else if (form.id === 'funds-form') await submit(`${form.dataset.mode === 'deposit' ? 'Deposit' : 'Withdraw'} ${symbol(token(form.dataset.token))}`, `/api/${form.dataset.mode}`, { account: state.account, tokenId: Number(form.dataset.token), amount: String(atoms(f.get('amount'), precision(token(form.dataset.token)))) });
    else if (form.id === 'shares-form') await transact(form.dataset.method === 'remliq' ? 'Remove liquidity' : 'Withdraw lending balance', form.dataset.method, { market: key(m.id), shares: String(withdrawalOwnership(form)), ...(form.dataset.method === 'unlend' ? { base: form.dataset.base === 'true' } : {}) });
    else if (form.id === 'repay-form') {const t=form.dataset.long==='true'?q:b;await transact('Repay margin loan', 'repay', { market: key(m.id), long: form.dataset.long === 'true', price: form.dataset.price, units: String(unitsFromAmount(atoms(f.get('amount'),precision(t)),form.dataset.face,'Repayment')) });}
    else if (form.id === 'create-form') {
      const base = await resolveToken(f.get('base')), quote = await resolveToken(f.get('quote'));
      if (key(base.id) === key(quote.id)) throw new Error('Choose two different tokens.');
      const previous = new Set((state.data.markets || []).map(m => key(m.id)));
      const lot=commit(atoms(f.get('min_size'),precision(base),'Minimum order size'));
      const step=atoms(f.get('price_step'),precision(quote),'Price increment');
      const scale=10n**BigInt(precision(base));
      if(step*lot%scale)throw new Error('The price increment is too small for this minimum order size.');
      const quoteStep=commit(step*lot/scale,'Price increment');
      const result = await transact('Create market', 'create', { base: Number(base.id), quote: Number(quote.id), base_amount: String(commit(atoms(f.get('base_amount'), precision(base)), 'Base reserve')), quote_amount: String(commit(atoms(f.get('quote_amount'), precision(quote)), 'Quote reserve')), base_lot: String(lot), quote_tick: String(quoteStep) });
      const returnedId = result?.trace?.actionTraces?.at(-1)?.retval;
      const candidates = result ? (state.data.markets || []).filter(m => !previous.has(key(m.id))) : [];
      const created = (state.data.markets || []).find(m => returnedId !== undefined && key(m.id) === key(returnedId)) || (candidates.length === 1 ? candidates[0] : null);
      if (created) selectMarket(created.id);
    }
  } catch (error) { toast(error.message, 'error'); }
});
document.addEventListener('input', event => { if (event.target.closest('#ticket-content')) updateEstimates(); if (event.target.closest('#liquidity-form')) updateLiquidityPreview(); if(event.target.closest('#shares-form'))updateWithdrawalPreview(); });
$('#lend-asset').addEventListener('change', () => renderEarn());
$('#candle-resolution').addEventListener('change',()=>{state.interval=Number($('#candle-resolution').value);renderChart();});
$('#depth-range').addEventListener('input',()=>{try{depthBounds(1,$('#depth-range').value);state.depthRange=Number($('#depth-range').value);renderChart();}catch{/* Keep the prior view while a custom number is incomplete. */}});
$('#depth-range').addEventListener('change',()=>{try{depthBounds(1,$('#depth-range').value);state.depthRange=Number($('#depth-range').value);renderChart();}catch(error){toast(error.message,'error');$('#depth-range').value=String(state.depthRange);}});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(market())renderChart();},100);});
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
setInterval(() => { if (!state.pending && !state.fetches && !document.hidden) refresh(); }, 2000);
