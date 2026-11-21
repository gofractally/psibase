import { atoms, decimal, integer, committed as commit, priceTick, priceText, relayOutput, relayPrice, safeText as esc, ceilDiv } from './amounts.js';
import { creditStatus, fundingPaused } from './market-policy.js';
import { depthRows, orderSpread, quoteForSize, maximumBidSize, unitsFromAmount, ownershipForDeposit, ownershipForWithdrawal, tradePriceAtoms } from './order-book.js';
import { depthBounds } from './market-chart.js';
import { candleHistory, candleTimeLabel, CANDLE_INTERVALS } from './candle-history.js';
import { getSupervisor, siblingUrl, isRedirectErrorObject, handlePluginUserPrompt } from '/common/common-lib.js';
import { createNativeWallet } from './native-wallet.js';
import { transferHistory } from './token-history.js';
import { projectPortfolio } from './portfolio.js';
import { createPageView, mergeRows, initialMarket, marketUrl } from './page-view.js';
import { ownStops, stopPayouts, stopRemaining, canCancelStop, stopStatus, validateStopTrigger, minimumStopAmount } from './stop-orders.js';
const wallet=createNativeWallet(getSupervisor(),{isPrompt:isRedirectErrorObject,onPrompt:(error,intent)=>{rememberDraft(intent);handlePluginUserPrompt(error,'/');}});
const PROFILE=new URLSearchParams(location.search).get('profile')==='1';
const profile=(kind,metrics)=>{if(PROFILE)console.debug('[exchange-profile]',JSON.stringify({kind,...metrics}));};

const $ = selector => document.querySelector(selector);
const state = { account: null, market: null, data: null, side: 'buy', type: 'market', ticket: 'spot', orderTab: 'orders', pending: false, online: false, activity: [], refresh: 0, fetches: 0, chart: 'price', interval: 5, depthRange: 2, bookView: 'orders', trades: new Map(), tradeRequests: new Set() };
state.olderStops=null;state.stopPageLoading=false;state.stopPageRequest=0;
state.accountTab='assets';state.fundsToken=null;state.history=null;state.historyToken=null;state.historyLoading=false;state.historySequence=0;state.historyNeedsLoad=false;state.accountSync=0;
state.candles=new Map();state.candleRequests=new Set();
state.catalog=createPageView('markets',row=>key(row.id));state.pointMarkets=new Map();
state.assetsPage=createPageView('',row=>key(row.token??row.token_id));
state.positionsPage=createPageView('',row=>`${key(row.market)}:${key(row.generation??row.price??'')}:${row.bid??row.base??''}`);
state.positionLoans=[];state.privateEpoch=0;state.fundsSequence=0;state.extraAssets=new Map();state.bookPages=new Map();state.fundingContinue=null;
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
const knownTokens=()=>mergeRows([...tokenCache.values()],state.data?.tokens||[],row=>key(row.id));
const catalogMarkets=()=>mergeRows(mergeRows(state.catalog.rows,[...state.pointMarkets.values()],row=>key(row.id)),state.data?.markets||[],row=>key(row.id));
const assets = m => ({ b: token(m.base), q: token(m.quote) });
const fmt = (v, t, places = precision(t)) => decimal(value(v), precision(t), places);
const price = (p, m = market()) => { const { b, q } = assets(m); return priceText(p, m, { ...b, precision: precision(b) }, { ...q, precision: precision(q) }); };
let portfolio=projectPortfolio(null,null);
const balance = id => portfolio.balance(id);
const available = id => portfolio.available(id);
const committed = id => portfolio.committed(id);
const levels = m => (state.data?.levels || []).filter(l => key(l.market) === key(m.id) && l.active !== false && value(l.outgoing) > 0n);
const coin = t => `<span class="coin ${symbol(t) === 'BTC' ? 'coin-btc' : symbol(t) === 'USD' ? 'coin-usd' : 'coin-other'}">${symbol(t) === 'BTC' ? '₿' : symbol(t) === 'USD' ? '$' : esc(symbol(t).slice(0, 1))}</span>`;
const empty = (heading, message, icon = '≋') => `<div class="empty-state"><span class="empty-icon">${icon}</span><strong>${esc(heading)}</strong><span>${esc(message)}</span></div>`;

async function api(path, body) {
  const started=PROFILE?performance.now():0;
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const received=PROFILE?performance.now():0;
  let data;
  try {
    if(PROFILE){const text=await response.text();data=JSON.parse(text);const decoded=performance.now();profile('api',{path,status:response.status,bytes:new TextEncoder().encode(text).byteLength,fetchMs:+(received-started).toFixed(2),decodeMs:+(decoded-received).toFixed(2),totalMs:+(decoded-started).toFixed(2)});}
    else data = await response.json();
  } catch { throw new Error(`Psibase returned HTTP ${response.status}.`); }
  if (!response.ok || data.error || data.ok === false) {
    const error=new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||`Transaction rejected (HTTP ${response.status}).`);
    if(data.progress)error.progress=data.progress;
    throw error;
  }
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
  document.querySelectorAll('button[type="submit"], button[data-action], button[data-position-action], button[data-stop-page], button[data-release-stop],button[data-release-position]').forEach(button => { button.disabled = button.closest('#market-search-form')?pending:pending || !state.account || key(state.data?.owner)!==state.account || button.dataset.locked === 'true'; });
  document.querySelectorAll('#ticket-content input,#ticket-content select,#ticket-content button,#market-select,#market-search-form input,#market-search-form button,#asset-search-form input,#asset-search-form button,[data-paged-repay],#continue-funding,[data-ticket],[data-select-market],[data-open="create"],[data-funds],#lend-form input,#lend-form select,#liquidity-form input,#modal input,#modal select').forEach(control=>{if(control.matches('button[type=submit],button[data-action]'))return;control.disabled=pending||control.dataset.locked==='true';});
  $('#account').disabled = pending;
  $('#account-button').disabled=pending;
  $('#connect-account').disabled=pending;
  $('#logout').disabled=pending;
}
async function transact(label, method, args) {
  return submit(label,owner=>wallet.execute(method,args,owner),{kind:'execute',method,args,owner:state.account});
}
async function submit(label, operation,request=null) {
  if (state.pending) return;
  if(!state.account){toast('Connect your Psibase account to continue.','error');return;}
  if(key(state.data?.owner)!==state.account){toast('Your account balances are still loading. Please review them before submitting.','error');return;}
  const owner=state.account;
  clearOlderStops();
  setPending(true);
  if(market())renderOrders();
  state.pendingLabel=label;
  state.pendingDraft=viewDraft();
  toast(`${label} · confirming with Psibase…`, 'pending');
  try {
    if(await wallet.currentUser()!==owner)throw new Error('Your connected account changed. Refresh before submitting.');
    const result = await operation(owner);
    if(result?.executed===false||result?.status==='scan_progress'){if(result.status!=='scan_progress')resetPrivatePages();if(request){state.fundingContinue={...request,summary:request.summary||describeRequest(label,request),label,owner,cursor:Object.hasOwn(result,'funding_cursor')?result.funding_cursor:request.cursor,status:result.status};if($('#modal').open)$('#modal').close();renderFundingProgress();}toast(result.status==='scan_progress'?'More funds may be available. Continue the bounded search when ready.':'Some funds were prepared. Continue the same request when ready.');await refresh();return result;}
    const id = result?.transactionId || result?.transaction_id || result?.id || '';
    resetPrivatePages();
    state.bookPages.clear();
    state.activity.unshift({ label, time: new Date().toISOString(), id: key(id), account:owner });
    state.activity = state.activity.slice(0, 100);
    try{localStorage.setItem('relay-recent-actions',JSON.stringify(state.activity));}catch{}
    toast(`${label} confirmed${id ? ` · ${key(id).slice(0, 12)}…` : ''}`);
    if ($('#modal').open) $('#modal').close();
    state.history=null;
    await refresh();
    renderRecentActions();
    return result;
  } catch (error) { resetPrivatePages();renderFundingProgress();await refresh();toast(error.message || String(error), 'error'); }
  finally { state.pendingLabel=null;state.pendingDraft=null;setPending(false); }
}
function fundingRequest(intent){
  if(intent?.service!=='exchange'||intent.intf!=='user')return null;
  const p=intent.params||[];
  if(intent.method==='execute'){try{return {kind:'execute',method:p[0],args:JSON.parse(p[1]),owner:p[2],cursor:p[3]};}catch{return null;}}
  return intent.method==='withdraw'?{kind:'withdraw',tokenId:p[0],amount:p[1],owner:p[2],cursor:p[3]}:null;
}
function describeRequest(label,request){
  const form=$('#modal').open?$('#modal form'):request?.method==='lend'?$('#lend-form'):request?.method==='addliq'?$('#liquidity-form'):$('#ticket-content form');
  const fields=[];
  for(const field of form?.elements||[]){if(!field.name||!['INPUT','SELECT'].includes(field.tagName)||field.type==='file')continue;
    const labelText=[...(field.closest('label')?.childNodes||[])].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ');
    const text=field.tagName==='SELECT'?field.selectedOptions[0]?.textContent:field.value,unit=field.closest('.input-wrap')?.querySelector('span')?.textContent||'';
    if(text)fields.push(`${labelText||field.name}: ${text}${unit?' '+unit:''}`);
  }
  return [label,request?.args?.market?'Market #'+request.args.market:'',...fields].filter(Boolean).join(' · ');
}
function renderFundingProgress(){
  const request=state.fundingContinue;$('#funding-progress').hidden=!request;
  if(request)$('#funding-progress-note').textContent=`${request.summary||request.label}. `+(request.status==='scan_progress'?'This page submitted no transaction. Continue to check another bounded page for funds for this exact request.':'Some proceeds were returned to your balance. Review your balances, then continue this exact request.');
}
async function continueFunding(){
  const r=state.fundingContinue;if(!r||state.pending)return;
  if(r.owner!==state.account){state.fundingContinue=null;renderFundingProgress();return;}
  await submit(r.label,owner=>r.kind==='execute'?wallet.execute(r.method,r.args,owner,r.cursor):wallet.withdraw(r.tokenId,r.amount,owner,r.cursor),r);
}
function cacheMetadata(data){for(const t of data.tokens||[])tokenCache.set(key(t.id),t);}
async function loadMarkets(more=false){
  const ticket=state.catalog.begin();if(!ticket)return;
  try{const data=await api(`/markets?limit=100${more&&state.catalog.next?`&after=${encodeURIComponent(state.catalog.next)}`:''}`);cacheMetadata(data);state.catalog.accept(ticket,{rows:data.markets||[],next:data.next_after},{append:more});if(state.market==null)state.market=state.catalog.rows[0]?.id??null;if(state.data)render();}
  catch(error){toast(error.message,'error');}finally{state.catalog.finish(ticket);renderMarketDiscovery();}
}
async function refresh() {
  const seq=++state.refresh,owner=state.account,selected=key(state.market);state.fetches++;
  try{
    let data;
    if(owner)data=await wallet.scopedSnapshot(selected||undefined);
    else if(selected){
      const [point,bids,asks]=await Promise.all([api(`/market?market=${encodeURIComponent(selected)}`),api(`/book?market=${encodeURIComponent(selected)}&bid=true&limit=200`),api(`/book?market=${encodeURIComponent(selected)}&bid=false&limit=200`)]);
      data={markets:point.market?[point.market]:[],tokens:point.tokens||[],levels:[...(bids.levels||[]),...(asks.levels||[])],continuations:{book_bid:bids.next_after,book_ask:asks.next_after},coverage_complete:false};
    }else data={markets:[],tokens:[],levels:[]};
    if(seq!==state.refresh||owner!==state.account||selected!==key(state.market))return;
    data=data.snapshot||data.data||data;
    if(owner&&key(data.owner)!==owner){if(await wallet.currentUser()!==owner){await syncAccount();refresh();return;}throw new Error('Native wallet response did not match your connected account.');}
    if(owner&&['deposit','withdraw'].includes(state.ticket)&&state.fundsToken&&!(data.balances||[]).some(row=>key(row.token??row.token_id)===state.fundsToken)){const point=await wallet.asset(Number(state.fundsToken));if(key(point.owner)!==owner)throw new Error('Asset response did not match your connected account.');data.balances=mergeRows(data.balances||[],point.balances||[],row=>key(row.token??row.token_id));data.tokens=mergeRows(data.tokens||[],point.tokens||[],row=>key(row.id));}
    if(seq!==state.refresh||owner!==state.account||selected!==key(state.market))return;
    if(owner&&key(data.owner)!==owner)throw new Error('Native wallet response did not match your connected account.');
    state.privateEpoch++;state.data=data;cacheMetadata(data);portfolio=projectPortfolio(data,owner);
    if(state.market==null)state.market=data.markets?.[0]?.id??null;
    state.online=true;$('#connection-banner').hidden=true;renderAccount();
    if(state.historyNeedsLoad&&owner&&$('#account-dialog').open&&state.accountTab==='history'){state.historyNeedsLoad=false;loadHistory();}
    $('#chain-status').innerHTML='<i></i> Psibase connected';$('#chain-status').className='';render();
    if($('#account-dialog').open&&owner){if(state.accountTab==='assets'&&!state.assetsPage.openedAt&&!state.assetsPage.loading)loadAssets();if(state.accountTab==='positions'&&!state.positionsPage.openedAt&&!state.positionsPage.loading)loadOwnPositions();}
    if(market()&&!$('#trade-view').hidden){if(state.bookView==='trades')loadTrades(market().id);if(state.chart==='price')loadCandles(market().id);}
    return true;
  }catch(error){
    if(seq!==state.refresh||owner!==state.account||selected!==key(state.market))return false;
    state.online=false;$('#connection-banner').textContent=`Psibase connection unavailable: ${error.message} Retrying automatically.`;$('#connection-banner').hidden=false;
    $('#chain-status').innerHTML='<i></i> Reconnecting';$('#chain-status').className='offline';
    if(!state.data)$('#orders-content').innerHTML=empty('Connecting to your exchange','The interface reads live native chain state.');return false;
  }finally{state.fetches--;}
}
function resetPrivatePages(){
  state.fundsSequence++;state.privateEpoch++;
  state.assetsPage.reset(state.account||'');state.positionsPage.reset('');state.positionLoans=[];state.extraAssets.clear();state.fundingContinue=null;
  if($('#account-positions'))$('#account-positions').querySelector('#own-position-rows').innerHTML='';renderFundingProgress();
}
function renderMarketDiscovery(){
  $('#more-markets').hidden=!state.catalog.next;$('#more-markets').disabled=state.catalog.loading;
  $('#market-discovery-note').textContent=`${state.catalog.rows.length} markets loaded${state.catalog.next?' · More available':''}. Catalog values reflect the last page query. Open any market by ID.`;
}
function positionScope(){return `${state.account||''}:${$('#position-kind').value}:${$('#position-market').value.trim()}`;}
async function loadOwnPositions(more=false){
  if(!state.account)return;
  const owner=state.account,kind=$('#position-kind').value;let filter=$('#position-market').value.trim();
  try{if(filter){filter=String(integer(filter,'Market ID'));$('#position-market').value=filter;}}catch(error){toast(error.message,'error');return;}
  const scope=positionScope();if(!more||state.positionsPage.scope!==scope){state.positionsPage.reset(scope);state.positionLoans=[];}
  const view=state.positionsPage,ticket=view.begin();if(!ticket)return;renderOwnPositions();
  try{
    const response=kind==='stops'?await wallet.stops(more?view.next:undefined,100):await wallet.positions(kind,filter||undefined,more?view.next:undefined,100);
    const data=kind==='stops'?{...response,rows:response.stop_positions,next_after:response.next_before}:response;
    if(owner!==state.account||scope!==positionScope())return;if(key(data.owner)!==owner||(data.rows||[]).some(row=>key(row.owner??row.account)!==owner))throw new Error('Position response did not match your connected account.');
    if(!view.accept(ticket,{rows:data.rows||[],next:data.next_after},{append:more}))return;
    cacheMetadata(data);state.positionLoans=mergeRows(state.positionLoans,data.loans||[],row=>key(row.generation??row.id));
    view.markets=mergeRows(view.markets||[],data.markets||[],row=>key(row.id));
  }catch(error){if(owner===state.account)toast(error.message,'error');}finally{view.finish(ticket);if(owner===state.account&&scope===positionScope())renderOwnPositions();}
}
function renderOwnPositions(){
  const view=state.positionsPage,kind=$('#position-kind').value,marketMap=new Map((view.markets||[]).map(m=>[key(m.id),m])),loanMap=new Map(state.positionLoans.map(g=>[key(g.generation??g.id),g]));
  $('#position-page-note').textContent=view.loading?'Reading your positions…':view.openedAt?`${view.rows.length} positions loaded${view.next?' · More available':''}. Values reflect each page’s last query; refresh to return to the first page.`:'Choose a position type and read your positions.';
  $('#more-positions').hidden=!view.next;$('#more-positions').disabled=view.loading;
  const shownRows=kind==='stops'&&$('#position-market').value.trim()?view.rows.filter(row=>key(row.market)===$('#position-market').value.trim()):view.rows;
  if(kind==='stops'&&$('#position-market').value.trim())$('#position-page-note').textContent+=' Stop pages traverse all markets; this filter applies to the loaded rows.';
  $('#own-position-rows').innerHTML=shownRows.length?`<table class="data-table"><thead><tr><th>Market</th><th>Position</th><th>Amount / status</th><th></th></tr></thead><tbody>${shownRows.map(row=>{
    const m=marketMap.get(key(row.market));if(!m)return '';
    const {b,q}=assets(m);let detail='',amount='',action='';
    if(kind==='stops'){const input=row.sell_base?b:q;detail=`${row.sell_base?'Sell':'Buy'} stop · ${price(row.trigger,m)} ${symbol(q)}`;amount=`${fmt(stopRemaining(row),input)} ${symbol(input)} · ${stopStatus(row)}`;action=canCancelStop(row)?`<button class="button small subtle" data-position-action="cancelstop" data-generation="${esc(row.generation)}">Cancel</button>`:`<button class="button small subtle" data-release-stop="${esc(row.generation)}">Return proceeds</button>`;}
    else if(kind==='orders'){detail=`${row.bid?'Buy':'Sell'} · ${price(row.price,m)} ${symbol(q)}`;amount=`${fmt(value(row.refund),row.bid?q:b)} ${symbol(row.bid?q:b)} remaining`;action=row.active===false?`<button class="button small subtle" data-release-position="orders" data-position-market="${esc(row.market)}" data-side="${Boolean(row.bid)}" data-price="${esc(row.price)}">Receive proceeds</button>`:`<button class="button small subtle" data-position-action="cancel" data-position-market="${esc(row.market)}" data-bid="${Boolean(row.bid)}" data-price="${esc(row.price)}">Cancel</button>`;}
    else if(kind==='loans'){const loan=loanMap.get(key(row.generation));if(!loan)return '';detail=loan.long?'Long':'Short';amount=loan.active!==false?`${fmt(value(row.units)*value(loan.face_unit),loan.long?q:b)} ${symbol(loan.long?q:b)} owed`:`${fmt(loan.claimable_surplus??0,loan.long?q:b)} ${symbol(loan.long?q:b)} proceeds`;action=loan.active!==false?`<button class="button small subtle" data-paged-repay="${esc(row.generation)}" data-position-market="${esc(row.market)}">Repay</button>`:`<button class="button small subtle" data-release-position="loans" data-position-market="${esc(row.market)}" data-price="${esc(row.price??loan.price)}" data-side="${Boolean(loan.long)}">Close</button>`;}
    else if(kind==='lenders'){const t=row.base?b:q,supply=value(row.base?m.lending_base:m.lending_quote)||1n,nav=value(row.base?m.vault_base:m.vault_quote)+value(row.base?m.debt_base:m.debt_quote);detail=`${symbol(t)} lending`;amount=`${fmt(value(row.shares)*nav/supply,t)} ${symbol(t)}`;}
    else{detail='Market making';amount=`${fmt(value(row.shares)*value(m.x)/(value(m.lp_supply)||1n),b)} ${symbol(b)} + ${fmt(value(row.shares)*value(m.y)/(value(m.lp_supply)||1n),q)} ${symbol(q)}`;}
    return `<tr><td>${esc(symbol(b))}/${esc(symbol(q))}<small class="order-kind">#${esc(row.market)}</small></td><td>${esc(detail)}</td><td>${esc(amount)}</td><td>${action}<button class="button small ghost" data-select-market="${esc(row.market)}">Open market</button></td></tr>`;
  }).join('')}</tbody></table>`:empty('No positions in this page','Search another market or position type.');setPending(state.pending);
}
async function loadAssets(more=false){
  if(!state.account)return;const owner=state.account,view=state.assetsPage;if(!more)view.reset(owner);const ticket=view.begin();if(!ticket)return;
  try{const data=await wallet.assets(more?view.next:undefined,100);if(owner!==state.account||key(data.owner)!==owner)return;cacheMetadata(data);view.accept(ticket,{rows:data.balances||[],next:data.next_after},{append:more});}
  catch(error){if(owner===state.account)toast(error.message,'error');}finally{view.finish(ticket);if(owner===state.account)renderBalances();}
}
async function loadAsset(id){
  if(!state.account)return;const owner=state.account,epoch=state.privateEpoch,n=integer(id,'Token ID');if(n>4294967295n)throw new Error('Token ID must fit a native u32.');
  const data=await wallet.asset(Number(n));if(owner!==state.account||epoch!==state.privateEpoch)return;if(key(data.owner)!==owner||key(state.data?.owner)!==owner)throw new Error('Your account balances are still loading.');cacheMetadata(data);
  const row=(data.balances||[])[0]||data.balance;if(row){state.extraAssets.set(key(n),row);state.data.balances=mergeRows(state.data.balances||[],[row],r=>key(r.token??r.token_id));state.data.tokens=mergeRows(state.data.tokens||[],data.tokens||[],r=>key(r.id));portfolio=projectPortfolio(state.data,owner);}
  renderAccount();renderBalances();return row;
}
function reviewPositions(kind,filter=key(state.market)){
  $('#position-kind').value=kind;$('#position-market').value=filter;state.positionsPage.reset(positionScope());state.positionLoans=[];$('#account-dialog').showModal();selectAccountTab('positions');
}
async function loadBookSide(bid){
  const id=key(state.market),scope=`${id}:${bid}`,view=state.bookPages.get(scope)||createPageView(scope,row=>`${row.bid}:${key(row.price)}`);
  if(!view.openedAt){const seed=view.begin();view.accept(seed,{rows:levels(market()).filter(row=>Boolean(row.bid)===bid),next:state.data.continuations?.[bid?'book_bid':'book_ask']});}
  state.bookPages.set(scope,view);if(!view.next){renderBook();return;}const ticket=view.begin();if(!ticket)return;
  try{const data=await api(`/book?market=${encodeURIComponent(id)}&bid=${bid}&limit=100&after=${encodeURIComponent(view.next)}`);if(id!==key(state.market))return;view.accept(ticket,{rows:data.levels||[],next:data.next_after},{append:true});}
  catch(error){toast(error.message,'error');}finally{view.finish(ticket);if(id===key(state.market))renderBook();}
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

async function loadCandles(id,{before=null,force=false}={}){
  const interval=state.interval,request=`${key(id)}:${interval}`,cached=state.candles.get(request),now=Date.now();
  if(state.candleRequests.has(request)||(!force&&(cached?.before||now-(cached?.requestedAt||0)<(interval>=3600?10000:2000))))return;
  state.candleRequests.add(request);
  const record={...cached,requestedAt:now};state.candles.set(request,record);
  try{
    const result=await api(`/candles?market=${encodeURIComponent(key(id))}&interval=${interval}&limit=200${before?`&before=${encodeURIComponent(before)}`:''}`);
    const page=candleHistory(result,interval);
    state.candles.set(request,{candles:page.candles,pricePrecision:page.pricePrecision,beforeCursor:page.before,before,requestedAt:now,revision:(cached?.revision||0)+1,error:null});
  }catch(error){state.candles.set(request,{...record,error:error.message,revision:(cached?.revision||0)+1});}
  finally{state.candleRequests.delete(request);if(key(state.market)===key(id)&&state.interval===interval&&state.chart==='price')renderChart();}
}

function render() {
  const started=PROFILE?performance.now():0;
  renderState();
  if(PROFILE)profile('render',{durationMs:+(performance.now()-started).toFixed(2)});
}
function renderState() {
  const markets = catalogMarkets();
  const signature = markets.map(m => `${m.id}:${m.base}:${m.quote}`).join(',');
  if ($('#market-select').dataset.signature !== signature) {
    $('#market-select').innerHTML = markets.length ? markets.map(m => `<option value="${esc(m.id)}">${esc(symbol(token(m.base)))} / ${esc(symbol(token(m.quote)))} · #${esc(m.id)}</option>`).join('') : '<option value="">No market yet</option>';
    $('#market-select').dataset.signature = signature;
  }
  $('#market-select').value = key(state.market);
  $('#balance-account').textContent = state.account ? `@${state.account}` : 'Connect account';
  if($('#account-dialog').open&&state.accountTab==='assets')renderBalances();
  renderMarketList();renderMarketDiscovery();
  if(['deposit','withdraw'].includes(state.ticket)&&!$('#ticket-content').dataset.ready)renderTicket();
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
  if($('#funds-available')){const t=token(state.fundsToken);$('#funds-available').textContent=`${fmt(state.ticket==='deposit'?balance(t.id).wallet:available(t.id),t)} ${symbol(t)}`;}
}

function renderBook() {
  const m = market(); const { b, q } = assets(m);
  const nextDepth = new Map();
  for (const bid of [false, true]) {
    const page=state.bookPages.get(`${key(m.id)}:${bid}`);
    const candidates=page?.openedAt?page.rows:levels(m),localMore=!page?.openedAt&&candidates.filter(row=>Boolean(row.bid)===bid).length>14;
    let rows = depthRows(candidates,m,bid,page?.openedAt?1000000:14);
    const cursor=page?.openedAt?page.next:state.data.continuations?.[bid?'book_bid':'book_ask'];
    $(bid?'#more-bids':'#more-asks').hidden=!cursor&&!localMore;
    $(bid?'#more-bids':'#more-asks').disabled=Boolean(page?.loading);
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
    const side=$(bid?'#bids':'#asks'),atBest=bid?side.scrollTop<5:side.scrollTop+side.clientHeight>=side.scrollHeight-5;
    side.innerHTML = content || `<div class="empty-book"><strong>No open ${bid ? 'buy' : 'sell'} orders</strong><span>Market maker liquidity is available.</span></div>`;
    if(!bid&&(atBest||!page?.openedAt))side.scrollTop=side.scrollHeight;
  }
  $('#book-page-note').textContent=state.bookPages.size?'Expanded depth is a page view. Refresh depth for current nearest orders.':(state.data.continuations?.book_bid||state.data.continuations?.book_ask)?'Nearest orders shown · more depth available.':'';
  previousDepth = nextDepth;
  const spread = orderSpread(levels(m), m);
  $('#book-spread').textContent = spread ? `${price(spread.ticks)} ${symbol(q)} · ${decimal(spread.percentScaled, 4, 4)}%` : '—';
  renderTape();
}
function renderTape() {
  if (!market()) return;
  $('#recent-trades').hidden = state.bookView !== 'trades';
  for (const selector of ['.book-columns', '#asks', '.book-mid', '.book-spread', '#bids', '.book-foot', '.book-pagination']) $(selector).hidden = state.bookView === 'trades';
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
  $('#chart-subtitle').textContent = state.chart === 'price' ? (state.interval===86400?'Daily candles · UTC':state.interval===3600?'Hourly candles · UTC':'Trading prices') : 'Cumulative buy and sell liquidity';
  document.querySelector('.curve-label').textContent = state.chart === 'price' ? '' : 'BUY / SELL DEPTH';
  $('#depth-controls').hidden=state.chart!=='depth';$('#candle-resolution').hidden=state.chart!=='price';$('#candle-pagination').hidden=state.chart!=='price';
  const foot=document.querySelectorAll('.chart-foot span');foot[0].textContent=state.chart==='price'?'':`−${state.depthRange}%`;foot[1].textContent=state.chart==='price'?(state.interval>=3600?'Times in UTC':'Trade volume'):'Cumulative liquidity';foot[2].textContent=state.chart==='price'?'':`+${state.depthRange}%`;
  const rect=$('#depth-chart').getBoundingClientRect(),history=state.candles.get(`${key(m.id)}:${state.interval}`);
  const signature=state.chart==='price'?`${m.id}:price:${state.interval}:${history?.revision||0}:${history?.before||''}:${rect.width}:${rect.height}`:`${m.id}:depth:${state.depthRange}:${m.x}:${m.y}:${m.k}:${levels(m).map(l=>`${l.bid}:${l.price}:${l.outgoing}`).join(',')}:${rect.width}:${rect.height}`;
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
  const cache=state.candles.get(`${key(m.id)}:${state.interval}`),candles=cache?.candles||[];
  $('#older-candles').hidden=!cache?.beforeCursor;
  $('#older-candles').disabled=state.candleRequests.has(`${key(m.id)}:${state.interval}`);
  $('#latest-candles').hidden=!cache?.before;
  if(!candles.length){$('#depth-chart').innerHTML=`<div class="chart-empty">${cache?.error?'Price history is temporarily unavailable.':cache?.candles?'No trading candles in this period.':'Loading price history…'}</div>`;return;}
  const box=$('#depth-chart').getBoundingClientRect();
  const W=Math.max(280,box.width-17),H=Math.max(210,box.height),left=65,right=W-22,top=15,volumeBottom=H-33,bottom=top+(volumeBottom-top)*.73,volumeTop=bottom+13;
  const priceToken={...q,precision:cache.pricePrecision};
  const scale=10**cache.pricePrecision,lo=Math.min(...candles.map(c=>Number(c.low)/scale)),hi=Math.max(...candles.map(c=>Number(c.high)/scale));
  const pad=Math.max((hi-lo)*.12,hi*.00002),low=lo-pad,high=hi+pad;
  const interval=state.interval*1000,first=candles[0].time-interval/2,last=candles.at(-1).time+interval/2;
  const px=time=>left+(time-first)/(last-first)*(right-left),py=p=>bottom-(p-low)/(high-low)*(bottom-top);
  const width=Math.max(2,Math.min(18,(right-left)/((last-first)/interval)*.66));
  const axisPrice=p=>p>0&&p<.000001?p.toExponential(3):p.toLocaleString(undefined,{maximumFractionDigits:Math.min(18,Math.max(2,-Math.floor(Math.log10(hi))+3))});
  const lines=[0,.25,.5,.75,1].map(f=>{const p=low+(high-low)*f,y=py(p);return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#223044" stroke-dasharray="2 5"/><text x="${left-8}" y="${y+3}" text-anchor="end" font-size="9" fill="#7187a1">${axisPrice(p)}</text>`;}).join('');
  const bodies=candles.map(c=>{const x=px(c.time),o=Number(c.open)/scale,h=Number(c.high)/scale,l=Number(c.low)/scale,close=Number(c.close)/scale,color=c.close>=c.open?'#33d4a3':'#f47888',y=Math.min(py(o),py(close)),height=Math.max(1.5,Math.abs(py(o)-py(close)));return `<g><title>${esc(state.interval>=3600?new Date(c.time).toLocaleString([],{timeZone:'UTC'}):new Date(c.time).toLocaleTimeString())} · O ${esc(fmt(c.open,priceToken))} H ${esc(fmt(c.high,priceToken))} L ${esc(fmt(c.low,priceToken))} C ${esc(fmt(c.close,priceToken))}</title><line x1="${x}" x2="${x}" y1="${py(h)}" y2="${py(l)}" stroke="${color}" stroke-width="1.2"/><rect x="${x-width/2}" y="${y}" width="${width}" height="${height}" rx=".6" fill="${color}" opacity="${c.complete?1:.7}"/></g>`;}).join('');
  const labelTimes=[...new Set([candles[0].time,candles[Math.floor(candles.length/2)].time,candles.at(-1).time])];
  const labels=labelTimes.map((time,index)=>`<text x="${px(time)}" y="${H-9}" fill="#7187a1" font-size="9" text-anchor="${labelTimes.length===1?'middle':index===0?'start':index===labelTimes.length-1?'end':'middle'}">${esc(candleTimeLabel(time,state.interval))}</text>`).join('');
  const close=Number(candles.at(-1).close)/scale;
  const maxVolume=candles.reduce((maximum,c)=>c.volume>maximum?c.volume:maximum,1n);
  const volumeBars=candles.map(c=>{const height=Number(c.volume)/Number(maxVolume)*(volumeBottom-volumeTop),color=c.close>=c.open?'#33d4a3':'#f47888';return `<rect x="${px(c.time)-width/2}" y="${volumeBottom-height}" width="${width}" height="${Math.max(1,height)}" fill="${color}" opacity=".33"><title>${esc(fmt(c.volume,b))} ${esc(symbol(b))}</title></rect>`;}).join('');
  const volumeAxis=`<line x1="${left}" x2="${right}" y1="${volumeTop}" y2="${volumeTop}" stroke="#223044"/><text x="${left-8}" y="${volumeTop+8}" text-anchor="end" font-size="8" fill="#7187a1">${esc(fmt(maxVolume,b,6))}</text><text x="${left+5}" y="${volumeTop+10}" font-size="8" fill="#7187a1">Volume ${esc(symbol(b))}</text>`;
  $('#depth-chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${state.interval===86400?'Daily':state.interval===3600?'Hourly':state.interval+'-second'} trading candlesticks">${lines}<line x1="${left}" x2="${right}" y1="${py(close)}" y2="${py(close)}" stroke="#7187a1" stroke-dasharray="3 5" opacity=".5"/>${bodies}${volumeAxis}${volumeBars}${labels}</svg>`;
}

function renderTicket() {
  $('#ticket-content').dataset.ready='1';
  if(['deposit','withdraw'].includes(state.ticket)){renderFunds();return;}
  if (!market()) return;
  $('#ticket-heading').textContent='Place an order';
  if(!state.account){$('#ticket-content').innerHTML='<div class="ticket-body"><div class="wallet-empty"><span>◎</span><h3>Trade with your account</h3><p>Connect your Psibase account to place orders. Your tokens stay under your account’s authority.</p><button class="button primary" data-connect>Connect account</button></div></div>';return;}
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
    const isLimit=state.type==='limit',isStop=state.type==='stop';
    const description=isStop?'Your order is funded now and executes at market when the trigger is reached. The execution price may differ from the trigger. Any unfilled amount is returned automatically.':isLimit?'A limit order executes at your price or better. You can cancel its remaining amount at any time.':'Your order executes against available buy and sell liquidity. Your minimum receive amount is protected.';
    const placeholder=precision(input)?`0.${'0'.repeat(precision(input))}`:'0';
    $('#ticket-content').innerHTML = `<form id="spot-form" class="ticket-body">
      <div class="buy-sell-toggle"><button type="button" class="${!sell?'active':''}" data-side="buy">Buy</button><button type="button" class="${sell?'active':''}" data-side="sell">Sell</button></div>
      <div class="order-type">${[['market','Market'],['limit','Limit'],['stop','Stop market']].map(([type,label])=>`<button type="button" data-type="${type}" class="${state.type===type?'active':''}">${label}</button>`).join('')}</div>
      <div class="available-row"><span>Available shown</span><strong id="ticket-available">—</strong></div>
      ${isLimit||isStop?`<label>${isStop?'Trigger price':'Limit price'}<div class="input-wrap"><input name="price" inputmode="decimal" placeholder="0.00" required><span>${esc(symbol(q))}</span></div></label>`:''}
      <label>${isLimit||(isStop&&sell)?'Size':sell?'Amount to sell':'Amount to spend'}<div class="input-wrap"><input name="amount" inputmode="decimal" placeholder="${placeholder}" required><span>${esc(symbol(input))}</span></div></label>
      <div class="percentage-row">${[25,50,75,100].map(n=>`<button type="button" data-percent="${n}">${n}%</button>`).join('')}</div>
      ${state.type==='market'?'<label>Slippage limit<div class="input-wrap"><input name="slippage" inputmode="decimal" value="1.00" required><span>%</span></div></label>':''}
      <div id="order-estimate" class="estimate-box"></div>
      <button type="submit" class="button ${sell?'sell':'buy'}">${isStop?`Place ${sell?'sell':'buy'} stop`:`${sell?'Sell':'Buy'} ${esc(symbol(b))}`}</button><p class="help-inline">${description}</p></form>`;
    if(isLimit||isStop){
      const current=value(m.y)*value(m.base_lot)/(value(m.x)*value(m.quote_tick));
      const numerator=isStop?(sell?95n:105n):(sell?105n:95n);
      $('#spot-form input[name=price]').value=price(current*numerator/100n).replace(/,/g,'');
    }
  }
  updateEstimates();
}
function estimateLine(label, text) { return `<div class="estimate-line"><span>${esc(label)}</span><strong>${esc(text)}</strong></div>`; }
function stopMinimum(m,sell,trigger){
  const positions=[...(state.data.stop_positions||[]),...ownStops(state.olderStops,state.account)];
  return minimumStopAmount(m,sell,trigger,{owner:state.account,stop_positions:positions},state.account);
}
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
      if(state.type==='stop'){
        const trigger=validateStopTrigger(priceTick(form.elements.price.value,m,{...b,precision:precision(b)},{...q,precision:precision(q)}),m,sell);
        const minimum=stopMinimum(m,sell,trigger);
        area.innerHTML=estimateLine('Trigger',`At or ${sell?'below':'above'} ${price(trigger)} ${symbol(q)}`)+estimateLine('Minimum amount at this stop price',`${fmt(minimum,input)} ${symbol(input)}`)+estimateLine('Amount reserved',`${fmt(amount,input)} ${symbol(input)}`)+estimateLine('Execution','Market order on trigger')+estimateLine('Unfilled amount','Returned automatically');
        updateLiquidityPreview();return;
      }else if (state.type === 'limit') {
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
  const stops=ownStops(state.data,state.account).filter(sameMarket);
  const openStops=stops.filter(p=>stopRemaining(p)>0n);
  const loans = (state.data.loan_positions || []).filter(p => own(p) && sameMarket(p) && (state.data.loans||[]).some(g=>key(g.generation??g.id)===key(p.generation)));
  $('#order-count').textContent=String(positions.length+openStops.length)+(state.data.continuations?.orders||state.data.continuations?.stops?'+':'');$('#loan-count').textContent=String(loans.length)+(state.data.continuations?.loans?'+':'');
  let html;
  if (state.orderTab === 'loans') {
    html = loans.length ? `<table class="data-table"><thead><tr><th>Position</th><th>Liquidation price</th><th>Amount owed</th><th>Collateral</th><th></th></tr></thead><tbody>${loans.map(p => {
      const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation)); if (!g) return '';
      const active = g.active !== false; const long = Boolean(g.long); const debtAsset = long ? q : b;
      const debt = active ? value(p.units) * value(g.face_unit) : value(p.units) * value(g.original_surplus ?? g.surplus) / (value(g.original_units) || 1n);
      const collateralAsset=long?b:q;
      return `<tr><td><span class="${long ? 'side-buy' : 'side-sell'}">${long ? 'Long' : 'Short'} ${esc(symbol(b))}</span></td><td>${esc(price(p.price ?? g.price))}</td><td>${esc(fmt(active?debt:0n, debtAsset))} ${esc(symbol(debtAsset))}${active ? '' : `<br><small>${esc(fmt(debt,debtAsset))} ${esc(symbol(debtAsset))} proceeds</small>`}</td><td>${active?`${esc(fmt(value(p.units)*value(g.collateral_unit),collateralAsset))} ${esc(symbol(collateralAsset))}`:'Released'}</td><td><button class="button small ${active ? 'subtle' : 'primary'}" data-position-action="${active ? 'repay' : 'claim'}" data-long="${long}" data-price="${esc(p.price ?? g.price)}" data-units="${esc(p.units)}" data-face="${esc(g.face_unit)}">${active ? 'Repay' : 'Close'}</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('No margin positions', 'Open a position from the Margin tab.', '◇');
  } else {
    html = positions.length||openStops.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Price / trigger</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody>${positions.map(p => {
      const remaining=value(p.remaining_outgoing??p.refund);
      const baseRemaining=p.remaining_base!==undefined?value(p.remaining_base):(p.bid?remaining*value(m.base_lot)/(value(p.price)*value(m.quote_tick)):remaining);
      const remainder=p.active===false;
      const amountText=baseRemaining>0n?`${fmt(baseRemaining,b)} ${symbol(b)}`:`${fmt(remaining,p.bid?q:b)} ${symbol(p.bid?q:b)}`;
      return `<tr><td><span class="${p.bid ? 'side-buy' : 'side-sell'}">${p.bid ? 'Buy' : 'Sell'} ${esc(symbol(b))}</span><small class="order-kind">Limit</small></td><td>${esc(price(p.price))}</td><td>${esc(amountText)}</td><td><span class="order-status">${remainder?'Remainder':'Open'}</span></td><td><button class="button small subtle" data-position-action="cancel" data-bid="${Boolean(p.bid)}" data-price="${esc(p.price)}">Cancel</button></td></tr>`;
    }).join('')}${openStops.map(p=>{
      const input=p.sell_base?b:q,cancelable=canCancelStop(p);
      return `<tr><td><span class="${p.sell_base?'side-sell':'side-buy'}">${p.sell_base?'Sell':'Buy'} ${esc(symbol(b))}</span><small class="order-kind">Stop market</small></td><td>${esc(price(p.trigger))}<small class="order-kind">${p.sell_base?'At or below':'At or above'}</small></td><td>${esc(fmt(stopRemaining(p),input))} ${esc(symbol(input))}</td><td><span class="order-status">${esc(stopStatus(p))}</span></td><td><button class="button small subtle" data-position-action="cancelstop" data-generation="${esc(p.generation)}" data-locked="${!cancelable}" ${cancelable?'':'disabled'}>Cancel</button></td></tr>`;
    }).join('')}</tbody></table>` : empty('Your orders will appear here', 'Place a limit or stop order at your chosen price.', '≋');
  }
  const more=state.data.continuations?.[state.orderTab==='loans'?'loans':'orders'];
  $('#orders-content').innerHTML = html+(state.orderTab==='loans'?'':renderOlderStops(m,b,q))+(more?`<div class="stop-pagination"><button class="button small ghost" data-review-positions="${state.orderTab==='loans'?'loans':'orders'}">Review more ${state.orderTab==='loans'?'margin positions':'orders'}</button></div>`:'');
  setPending(state.pending);
}

function clearOlderStops(){state.olderStops=null;state.stopPageLoading=false;state.stopPageRequest++;}
async function loadOlderStops(mode){
  if(state.pending||state.stopPageLoading)return;
  if(mode==='recent'){clearOlderStops();renderOrders();return;}
  const before=mode==='refresh'?state.olderStops?.before:state.olderStops?state.olderStops.next_before:state.data?.stop_positions_next;
  if(before===null||before===undefined)return;
  const account=state.account,marketId=key(state.market),request=++state.stopPageRequest;
  state.stopPageLoading=true;renderOrders();
  try{
    const page=await wallet.stops(before,100);
    if(request!==state.stopPageRequest||account!==state.account||marketId!==key(state.market))return;
    if(key(page.owner)!==account)throw new Error('Order response did not match the selected wallet.');
    state.olderStops={...page,before};
  }catch(error){toast(error.message,'error');}
  finally{if(request===state.stopPageRequest){state.stopPageLoading=false;if(market())renderOrders();}}
}
function renderOlderStops(m,b,q){
  const page=state.olderStops,next=page?page.next_before:state.data.stop_positions_next;
  if(!page&&(next===null||next===undefined))return '';
  let html='';
  if(page){
    const rows=ownStops(page,state.account).filter(sameMarket);
    html=`<div class="older-orders-heading">Older stop orders</div>${rows.length?`<table class="data-table"><thead><tr><th>Order</th><th>Trigger</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(p=>{
      const input=p.sell_base?b:q,output=p.sell_base?q:b,paid=stopPayouts(p),armed=p.status==='armed';
      const receipt=[paid.output?`${fmt(paid.output,output)} ${symbol(output)} received`:'',paid.input?`${fmt(paid.input,input)} ${symbol(input)} returned`:''].filter(Boolean).map(esc).join('<br>');
      const amount=armed?`${esc(fmt(stopRemaining(p),input))} ${esc(symbol(input))}`:receipt||'—';
      const action=armed?`<button class="button small subtle" data-position-action="cancelstop" data-generation="${esc(p.generation)}" data-locked="${!canCancelStop(p)}">Cancel</button>`:(paid.input||paid.output)?`<button class="button small subtle" data-release-stop="${esc(p.generation)}">Return to balance</button>`:'';
      return `<tr><td><span class="${p.sell_base?'side-sell':'side-buy'}">${p.sell_base?'Sell':'Buy'} ${esc(symbol(b))}</span><small class="order-kind">Stop market</small></td><td>${esc(price(p.trigger,m))}</td><td>${amount}</td><td><span class="order-status">${esc(stopStatus(p))}</span></td><td>${action}</td></tr>`;
    }).join('')}</tbody></table>`:'<p class="older-orders-empty">No orders in this page for the selected market.</p>'}`;
  }
  const locked=String(state.stopPageLoading);
  return html+`<div class="stop-pagination">${next===null||next===undefined?'':`<button class="button small ghost" data-stop-page="next" data-locked="${locked}">${state.stopPageLoading?'Loading…':page?'Next older orders':'Load older orders'}</button>`}${page?`<button class="button small ghost" data-stop-page="refresh" data-locked="${locked}">Refresh older orders</button><button class="button small ghost" data-stop-page="recent" data-locked="${locked}">Back to recent orders</button>`:''}</div>`;
}


function renderBalances() {
  if(!state.account){$('#balances').innerHTML='<tr><td colspan="5">Connect your Psibase account to view your assets.</td></tr>';return;}
  $('#available-balance-label').textContent='Available shown';
  $('#balances-subtitle').textContent='Wallet and trading cash are exact at their last query. Available and reserved amounts shown include current-market positions and recent stop orders; other positions can add proceeds.';
  const live=new Map((state.data?.balances||[]).map(row=>[key(row.token??row.token_id),row]));
  const rows=mergeRows(mergeRows(state.assetsPage.rows,[...state.extraAssets.values()],r=>key(r.token??r.token_id)),[...live.values()],r=>key(r.token??r.token_id));
  $('#balances').innerHTML=rows.map(row=>{
    const id=key(row.token??row.token_id),t=token(id),fresh=live.has(id),shown=fresh?available(id):value(row.spendable??value(row.incoming)+value(row.outgoing));
    return `<tr><td><div class="asset-name">${coin(t)}<div><strong>${esc(symbol(t))}</strong><small>Native token #${esc(id)}</small></div></div></td><td>${esc(fmt(row.wallet,t))}</td><td>${esc(fmt(shown,t))}</td><td class="committed-amount">${fresh?esc(fmt(committed(id),t)):'—'}</td><td><div class="balance-buttons"><button class="button ghost" data-funds="deposit" data-token="${esc(id)}">Deposit</button><button class="button ghost" data-funds="withdraw" data-token="${esc(id)}">Withdraw</button></div></td></tr>`;
  }).join('')||'<tr><td colspan="5">No assets in this page.</td></tr>';
  $('#more-assets').hidden=!state.assetsPage.next;$('#more-assets').disabled=state.assetsPage.loading;
  $('#asset-page-note').textContent=`${rows.length} assets shown${state.assetsPage.next?' · More available':''}. Extra asset pages keep their last-read values until refreshed.`;
}
function renderMarketList() {
  $('#market-list').innerHTML = catalogMarkets().map(m => {
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
  lendSubmit.disabled = state.pending || !state.account || !credit.enabled;
  $('#lend-eligibility').textContent = credit.reason;
  $('#lend-eligibility').hidden = credit.enabled;
  const liquiditySubmit = $('#liquidity-form button[type=submit]');
  liquiditySubmit.dataset.locked = String(fundingPaused(m));
  liquiditySubmit.disabled = state.pending || !state.account || fundingPaused(m);
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

async function showFunds(mode, id) {
  const seq=++state.fundsSequence,owner=state.account;
  try{const row=await loadAsset(id);if(!row||seq!==state.fundsSequence||owner!==state.account)return;}catch(error){toast(error.message,'error');return;}
  state.ticket=mode;state.fundsToken=key(id);
  document.querySelectorAll('[data-ticket]').forEach(el=>el.classList.toggle('active',el.dataset.ticket===mode));
  if($('#account-dialog').open)$('#account-dialog').close();
  setView('trade');renderTicket();
  $('#ticket-content').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderFunds() {
  const deposit=state.ticket==='deposit';
  const tokens=knownTokens();
  if(!tokens.some(t=>key(t.id)===key(state.fundsToken)))state.fundsToken=key(market()?.quote??tokens[0]?.id);
  const t=token(state.fundsToken);
  $('#ticket-heading').textContent=deposit?'Deposit funds':'Withdraw funds';
  if(!state.account){$('#ticket-content').innerHTML=`<div class="ticket-body"><div class="wallet-empty"><span>◎</span><h3>Your tokens. Your account.</h3><p>Connect your Psibase account to ${deposit?'deposit into':'withdraw from'} the exchange.</p><button class="button primary" data-connect>Connect account</button></div></div>`;return;}
  $('#ticket-content').innerHTML=`<form id="funds-form" class="ticket-body" data-mode="${deposit?'deposit':'withdraw'}"><p class="funds-intro">${deposit?'Move tokens from your wallet to your available exchange balance.':'Return available tokens to your wallet.'}</p><label>Token<select name="token" id="funds-token">${tokens.map(t=>`<option value="${esc(t.id)}" ${key(t.id)===key(state.fundsToken)?'selected':''}>${esc(symbol(t))}</option>`).join('')}</select></label><div class="available-row"><span>${deposit?'Wallet balance':'Available shown'}</span><strong id="funds-available">${esc(fmt(deposit?balance(t.id).wallet:available(t.id),t))} ${esc(symbol(t))}</strong></div><label>Amount<div class="input-wrap"><input name="amount" inputmode="decimal" placeholder="0.00" required><span>${esc(symbol(t))}</span></div></label><div class="percentage-row">${[25,50,75,100].map(n=>`<button type="button" data-funds-percent="${n}">${n}%</button>`).join('')}</div><div class="estimate-box">${estimateLine('From',deposit?`@${state.account} wallet`:'Exchange balance')}${estimateLine('To',deposit?'Exchange balance':`@${state.account} wallet`)}${estimateLine('Network','Psibase')}</div><button class="button primary" type="submit">${deposit?'Continue to Tokens':'Withdraw '+esc(symbol(t))}</button><p class="help-inline">${deposit?'Tokens reviews the amount and destination before you authorize. You can choose Trust exchange there to remember permission on this browser.':'Funds committed to open orders or collateral must first be released by cancelling an order or repaying a loan.'}</p><a class="wallet-shortcut" href="${esc(siblingUrl(null,'homepage','/tokens'))}">Open Tokens wallet ↗</a></form>`;
  setPending(state.pending);
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
  if(view==='trade'&&market()){renderChart();if(state.bookView==='trades')loadTrades(market().id);if(state.chart==='price')loadCandles(market().id);}
}
async function selectMarket(id) {
  if(state.pending)return;
  try{const numeric=integer(id,'Market ID'),point=await api(`/market?market=${encodeURIComponent(String(numeric))}`);if(!point.market)throw new Error('Market not found.');cacheMetadata(point);
    state.pointMarkets.set(key(point.market.id),point.market);
    clearOlderStops();state.bookPages.clear();state.market=String(numeric);history.replaceState(null,'',marketUrl(location.href,state.market));state.privateEpoch++;state.fundsSequence++;state.fundingContinue=null;renderFundingProgress();state.data=null;portfolio=projectPortfolio(null,null);$('#ticket-content').dataset.ready='';clearPrivateView();
    if($('#account-dialog').open)$('#account-dialog').close();await refresh();setView('trade');
  }catch(error){toast(error.message,'error');}
}

function viewDraft(){
  const form=$('#ticket-content form');
  const fields={};if(form)for(const input of form.elements)if(input.name&&input.type!=='file')fields[input.name]=input.value;
  return {account:state.account,market:key(state.market),ticket:state.ticket,type:state.type,side:state.side,fundsToken:state.fundsToken,fields,accountTab:state.accountTab,positionKind:$('#position-kind').value,positionMarket:$('#position-market').value,accountOpen:$('#account-dialog').open,chart:state.chart,interval:state.interval};
}
function rememberDraft(intent){
  try{sessionStorage.setItem('relay-wallet-return',JSON.stringify({...state.pendingDraft||viewDraft(),intent,label:state.pendingLabel}));}catch{}
}
function restoreDraft(){
  const raw=sessionStorage.getItem('relay-wallet-return');sessionStorage.removeItem('relay-wallet-return');
  if(!raw)return null;
  try{const draft=JSON.parse(raw);if(draft.account&&draft.account!==state.account)return null;if(state.data?.markets?.some(m=>key(m.id)===draft.market))state.market=draft.market;state.ticket=['spot','margin','deposit','withdraw'].includes(draft.ticket)?draft.ticket:'spot';state.type=['market','limit','stop'].includes(draft.type)?draft.type:'market';state.side=draft.side==='sell'?'sell':'buy';state.fundsToken=draft.fundsToken;if(CANDLE_INTERVALS.includes(draft.interval)){state.interval=draft.interval;$('#candle-resolution').value=String(draft.interval);}render();renderTicket();document.querySelectorAll('[data-ticket]').forEach(el=>el.classList.toggle('active',el.dataset.ticket===state.ticket));const form=$('#ticket-content form');if(form)for(const[name,value]of Object.entries(draft.fields||{})){const field=form.elements.namedItem(name);if(field&&typeof value==='string')field.value=value;}updateEstimates();if(['orders','stops','loans','lenders','liquidity'].includes(draft.positionKind))$('#position-kind').value=draft.positionKind;if(typeof draft.positionMarket==='string')$('#position-market').value=draft.positionMarket;if(draft.accountOpen&&state.account){$('#account-dialog').showModal();selectAccountTab(draft.accountTab||'assets');}return draft;}catch{return null;}
}
async function syncAccount(){
  const seq=++state.accountSync;
  const next=await wallet.currentUser()||null;
  if(seq!==state.accountSync)return;
  if(next!==state.account){state.account=next;clearOlderStops();resetPrivatePages();state.data=null;state.history=null;state.historyLoading=false;state.historyNeedsLoad=$('#account-dialog').open&&state.accountTab==='history';state.historySequence++;$('#transfer-history').innerHTML='';$('#history-pagination').innerHTML='';$('#trust-status').textContent='Loading permission…';$('#revoke-trust').hidden=true;$('#ticket-content').dataset.ready='';clearPrivateView();}
  const accounts=await wallet.accounts();
  if(seq!==state.accountSync)return;
  $('#account').innerHTML=(accounts||[]).map(account=>`<option value="${esc(account)}">@${esc(account)}</option>`).join('')||'<option value="">No account connected</option>';
  $('#account').value=next||'';renderAccount();
}
function clearPrivateView(){
  portfolio=projectPortfolio(null,null);
  $('#balance-account').textContent=state.account?`@${state.account}`:'Connect account';
  $('#balances').innerHTML='<tr><td colspan="5" style="padding:25px;color:var(--muted)">Loading your account balances…</td></tr>';
  $('#orders-content').innerHTML=empty('Loading your orders','Reading your connected account from Psibase.');
  $('#order-count').textContent='0';$('#loan-count').textContent='0';
  $('#ticket-content').innerHTML=empty('Loading your account','Your trading balances will appear shortly.','◎');
  $('#lender-positions').innerHTML='';$('#relay-position').innerHTML='';$('#liquidity-preview').innerHTML='';
  for(const selector of ['#lend-form input[name=amount]','#liquidity-form input[name=amount]'])$(selector).value='';
  if($('#modal').open)$('#modal').close();
  setPending(state.pending);
}
function renderAccount(){
  $('#account-name').textContent=state.account?`@${state.account}`:'Connect account';
  $('#account-identity').textContent=state.account?`@${state.account}`:'Your Psibase account';
  $('#logout').hidden=!state.account;
  $('#connect-account').textContent=state.account?'Connect another':'Connect account';
  $('#wallet-link').href=siblingUrl(null,'homepage','/tokens');
  const tokens=knownTokens();
  const previousHistoryToken=state.historyToken;
  if(!tokens.some(t=>key(t.id)===key(state.historyToken)))state.historyToken=key(market()?.quote??tokens[0]?.id);
  if(previousHistoryToken!==state.historyToken){state.history=null;state.historyLoading=false;state.historySequence++;$('#transfer-history').innerHTML='';$('#history-pagination').innerHTML='';state.historyNeedsLoad=$('#account-dialog').open&&state.accountTab==='history';}
  const signature=tokens.map(t=>`${key(t.id)}:${symbol(t)}`).join(',');
  if($('#history-token').dataset.signature!==signature){$('#history-token').innerHTML=tokens.map(t=>`<option value="${esc(t.id)}">${esc(symbol(t))}</option>`).join('');$('#history-token').dataset.signature=signature;}
  $('#history-token').value=state.historyToken;
  renderRecentActions();
}
async function connectAccount(){
  if(state.pending)return;
  try{await wallet.connect();await syncAccount();await refresh();}catch(error){toast(error.message||String(error),'error');}
}
function selectAccountTab(tab){
  state.accountTab=tab;
  for(const name of ['assets','positions','history','security'])$(`#account-${name}`).hidden=name!==tab;
  document.querySelectorAll('[data-account-tab]').forEach(el=>el.classList.toggle('active',el.dataset.accountTab===tab));
  if(tab==='assets'&&state.data){renderBalances();if(!state.assetsPage.openedAt)loadAssets();}
  if(tab==='positions'){renderOwnPositions();if(!state.positionsPage.openedAt)loadOwnPositions();}
  if(tab==='history'&&!state.history)loadHistory();
  if(tab==='security')loadTrust();
}
function renderRecentActions(){
  const rows=state.activity.filter(a=>a.account===state.account);
  $('#recent-actions').innerHTML=rows.map(a=>`<div class="activity-item"><span>✓</span><div>${esc(a.label)}<small>${a.id?esc(a.id):'Confirmed through your native wallet'}</small></div><time>${esc(new Date(a.time).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></div>`).join('')||empty('No recent browser actions','Confirmed actions from this browser appear here.');
}
async function loadHistory(before){
  if(!state.account){$('#transfer-history').innerHTML=empty('Connect your account','Your transaction history is private.');return;}
  if(state.historyLoading)return;
  const owner=state.account,tokenId=state.historyToken,seq=++state.historySequence;
  state.historyLoading=true;$('#history-refresh').disabled=true;$('#transfer-history').innerHTML='<p class="account-note">Reading your native Tokens history…</p>';$('#history-pagination').innerHTML='';
  try{const result=await wallet.history(tokenId,before);if(owner!==state.account||seq!==state.historySequence||tokenId!==state.historyToken)return;state.history=result;renderHistory(result);}
  catch(error){if(seq===state.historySequence)$('#transfer-history').innerHTML=empty('History unavailable',error.message||String(error));}
  finally{if(seq===state.historySequence){state.historyLoading=false;$('#history-refresh').disabled=false;}}
}
function renderHistory(result){
  const t=token(state.historyToken),page=transferHistory(result,{owner:state.account,tokenId:state.historyToken,precision:precision(t)});
  $('#transfer-history').innerHTML=page.rows.length?`<table class="data-table history-table"><thead><tr><th>Transfer</th><th>Amount</th><th>Confirmed</th></tr></thead><tbody>${page.rows.map(row=>`<tr><td><strong>${esc(row.label)}</strong><small>${esc(row.memo||'Wallet ↔ exchange')}</small></td><td>${esc(row.amount)} ${esc(symbol(t))}</td><td class="history-event">${esc(row.block.blockTime?new Date(row.block.blockTime).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):row.block.blockNum?'Block '+row.block.blockNum:'On chain')}</td></tr>`).join('')}</tbody></table>`:empty('No transfers yet',`Your ${symbol(t)} transfers with the exchange will appear here.`,'↗');
  $('#history-pagination').innerHTML=page.before?`<button class="button ghost" data-history-before="${esc(page.before)}">Older transfers</button>`:'';
}
async function loadTrust(){
  if(!state.account){$('#trust-status').textContent='Connect your account to review transfer permissions.';$('#revoke-trust').hidden=true;return;}
  const owner=state.account;
  try{const status=await wallet.trustStatus();if(owner!==state.account)return;const trusted=status===true||status==='trusted'||status?.trusted===true;$('#trust-status').textContent=trusted?'Exchange is trusted for wallet transfers on this browser.':'Each transfer requires your approval in Tokens.';$('#revoke-trust').hidden=!trusted;}
  catch(error){if(owner===state.account)$('#trust-status').textContent=error.message||String(error);}
}
async function initialize(){
  try{const recent=JSON.parse(localStorage.getItem('relay-recent-actions')||'[]');state.activity=Array.isArray(recent)?recent.filter(a=>typeof a.label==='string'&&typeof a.account==='string'&&Number.isFinite(Date.parse(a.time))).slice(0,100):[];}catch{}
  await loadMarkets();
  try{const draft=JSON.parse(sessionStorage.getItem('relay-wallet-return')||'null');const requested=initialMarket(location.search,draft);if(requested)state.market=requested;}catch{}
  if(!await refresh()&&state.catalog.rows.length){state.market=state.catalog.rows[0].id;await refresh();}
  try{await syncAccount();await refresh();const draft=restoreDraft();if(draft?.intent&&draft.label&&draft.account===state.account){const status=await wallet.approvalStatus();if(status==='approved')await submit(draft.label,()=>wallet.resume(draft.intent),fundingRequest(draft.intent));else toast(status==='denied'?'Transfer was declined. Your draft is ready to review.':'Your draft is ready. Review the details before submitting.');}}
  catch(error){toast(error.message||String(error),'error');}
}
$('#account-button').addEventListener('click',async()=>{if(!state.account){await connectAccount();return;}renderAccount();$('#account-dialog').showModal();selectAccountTab(state.accountTab);});
$('#connect-account').addEventListener('click',connectAccount);
$('#logout').addEventListener('click',async()=>{try{await wallet.logout();$('#account-dialog').close();await syncAccount();await refresh();}catch(error){toast(error.message,'error');}});
$('#history-token').addEventListener('change',()=>{state.historyToken=$('#history-token').value;state.history=null;state.historyLoading=false;state.historySequence++;loadHistory();});
$('#history-refresh').addEventListener('click',()=>loadHistory());
$('#revoke-trust').addEventListener('click',async()=>{try{await wallet.revokeTrust();await loadTrust();toast('Transfer trust revoked. Tokens will review your next transfer.');}catch(error){toast(error.message,'error');}});
window.addEventListener('focus',()=>{if(!state.pending)syncAccount().then(refresh).catch(()=>{});});

document.addEventListener('click', async event => {
  const button = event.target.closest('button,[data-price]'); if (!button) return;
  const d = button.dataset;
  if(state.pending&&(d.ticket||d.type||d.side||d.price||d.selectMarket||d.funds||d.open==='create'||'connect' in d))return;
  if(state.pending&&(d.pagedRepay||d.reviewPositions||d.releasePosition))return;
  if(d.releasePosition){await submit('Receive position proceeds',owner=>wallet.releasePosition(d.releasePosition,d.positionMarket,d.side==='true',d.price,owner));return;}
  if(d.reviewPositions){reviewPositions(d.reviewPositions);return;}
  if(d.pagedRepay){const row=state.positionsPage.rows.find(row=>key(row.generation)===d.pagedRepay),loan=state.positionLoans.find(loan=>key(loan.generation??loan.id)===d.pagedRepay);if(row&&loan){await selectMarket(row.market);showRepay({long:String(loan.long),price:row.price??loan.price,units:row.units,face:loan.face_unit});}return;}
  if(d.stopPage){await loadOlderStops(d.stopPage);return;}
  if(d.releaseStop){await submit('Return stop funds',owner=>wallet.releaseStop(d.releaseStop,owner));return;}
  if('connect' in d){await connectAccount();return;}
  if('accountClose' in d){$('#account-dialog').close();return;}
  if(d.accountTab){selectAccountTab(d.accountTab);return;}
  if(d.historyBefore){await loadHistory(d.historyBefore);return;}
  if(d.view){setView(d.view);if(d.view==='markets'&&!state.catalog.openedAt)loadMarkets();}
  if (d.zoom) { state.depthRange=Math.max(.05,Math.min(25,state.depthRange*(d.zoom==='in'?.5:2))); $('#depth-range').value=String(state.depthRange); renderChart(); }
  if (d.chart) { state.chart = d.chart; document.querySelectorAll('[data-chart]').forEach(el=>el.classList.toggle('active',el===button)); renderChart();if(state.chart==='price'&&market())loadCandles(market().id); }
  if (d.bookView) { state.bookView=d.bookView; document.querySelectorAll('[data-book-view]').forEach(el=>el.classList.toggle('active',el===button)); renderTape();if(state.bookView==='trades'&&market())loadTrades(market().id); }
  if (d.open === 'create') showCreate();
  if ('close' in d) $('#modal').close();
  if (d.funds) await showFunds(d.funds, d.token);
  if(d.fundsPercent&&$('#funds-form')){const t=token(state.fundsToken),amount=(state.ticket==='deposit'?value(balance(t.id).wallet):available(t.id))*BigInt(d.fundsPercent)/100n;$('#funds-form input[name=amount]').value=decimal(amount,precision(t),precision(t),false);}
  if (d.selectMarket) selectMarket(d.selectMarket);
  if (d.orderTab) { state.orderTab = d.orderTab; document.querySelectorAll('[data-order-tab]').forEach(el => el.classList.toggle('active', el === button)); if (market()) renderOrders(); }
  if(d.ticket||d.type||d.side||d.funds){state.fundingContinue=null;renderFundingProgress();}
  if (d.ticket) { state.ticket = d.ticket; document.querySelectorAll('[data-ticket]').forEach(el => el.classList.toggle('active', el === button)); renderTicket(); }
  if (d.side) { state.side = d.side; renderTicket(); }
  if (d.type) { state.type = d.type; renderTicket(); }
  if(d.percent||d.fundsPercent){state.fundingContinue=null;renderFundingProgress();}
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
    const field=$('#spot-form input[name=price]');if(field){field.value=price(d.price).replace(/,/g,'');updateEstimates();}
  }
  if (d.action === 'liquidate') await transact('Process liquidations', 'liquidate', { market: key(state.market), max_events: 64 });
  if (d.action === 'renew') await transact('Renew lending term', 'renew', { market: key(state.market) });
  if (d.positionAction) {
    if(d.positionAction==='cancelstop')await transact('Cancel stop order','cancelstop',{generation:d.generation});
    else if (['remliq', 'unlend'].includes(d.positionAction)) showShares(d.positionAction, d);
    else if (d.positionAction === 'repay') showRepay(d);
    else await transact(d.positionAction === 'cancel' ? 'Cancel order' : 'Receive position proceeds', d.positionAction, { market: d.positionMarket||key(state.market), price: d.price, ...(d.positionAction === 'cancel' ? { bid: d.bid === 'true' } : { long: d.long === 'true' }) });
  }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target; if (state.pending) return;
  const f = new FormData(form); const m = market(); const { b, q } = m ? assets(m) : {};
  try {
    if (!m && !['funds-form','create-form','market-search-form','asset-search-form'].includes(form.id)) throw new Error('Create or select a funded market first.');
    if (form.id === 'spot-form') {
      const sell = state.side === 'sell'; const input = sell ? b : q;
      if (state.type === 'limit') {const p=priceTick(f.get('price'),m,{...b,precision:precision(b)},{...q,precision:precision(q)});const size=atoms(f.get('amount'),precision(b),'Size');const total=quoteForSize(size,p,m);await transact('Place limit order','limit',{market:key(m.id),bid:!sell,price:String(p),amount:String(commit(sell?size:total))});}
      else if(state.type==='stop'){
        const trigger=validateStopTrigger(priceTick(f.get('price'),m,{...b,precision:precision(b)},{...q,precision:precision(q)}),m,sell);
        const amount=commit(atoms(f.get('amount'),precision(input),'Amount')),minimum=stopMinimum(m,sell,trigger);
        if(amount<minimum)throw new Error(`Minimum amount at this stop price: ${fmt(minimum,input)} ${symbol(input)}.`);
        await transact(`Place ${sell?'sell':'buy'} stop`,'stop',{market:key(m.id),sell_base:sell,trigger:String(trigger),amount:String(amount)});
      }
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
    else if(form.id==='market-search-form'){await selectMarket(f.get('market'));}
    else if(form.id==='asset-search-form'){await loadAsset(f.get('token'));}
    else if (form.id === 'lend-form') { if (!creditStatus(m).enabled) throw new Error(creditStatus(m).reason); const base = f.get('base') === 'true'; await transact('Supply lending vault', 'lend', { market: key(m.id), base, amount: String(commit(atoms(f.get('amount'), precision(base ? b : q)))) }); }
    else if (form.id === 'liquidity-form') await transact('Add relay liquidity', 'addliq', { market: key(m.id), shares: String(commit(ownershipForDeposit(atoms(f.get('amount'),precision(b)),m), 'Liquidity amount')) });
    else if (form.id === 'funds-form') {const t=token(f.get('token')),amount=atoms(f.get('amount'),precision(t));if(form.dataset.mode==='deposit'){if(amount>value(balance(t.id).wallet))throw new Error('Amount exceeds your wallet balance.');await submit(`Deposit ${symbol(t)}`,owner=>wallet.deposit(t.id,decimal(amount,precision(t),precision(t),false),owner));}else{await submit(`Withdraw ${symbol(t)}`,owner=>wallet.withdraw(t.id,String(amount),owner),{kind:'withdraw',tokenId:t.id,amount:String(amount),owner:state.account});}}
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
      if(created)await selectMarket(created.id);else if(result?.executed){await loadMarkets();reviewPositions('liquidity','');toast('Market created. Find it in your liquidity positions; load more if needed.');}
    }
  } catch (error) { toast(error.message, 'error'); }
});
document.addEventListener('input', event => {if(event.target.closest('#ticket-content,#modal,#lend-form,#liquidity-form')){state.fundingContinue=null;renderFundingProgress();} if (event.target.closest('#ticket-content')) updateEstimates(); if (event.target.closest('#liquidity-form')) updateLiquidityPreview(); if(event.target.closest('#shares-form'))updateWithdrawalPreview(); });
$('#lend-asset').addEventListener('change', () => renderEarn());
$('#candle-resolution').addEventListener('change',()=>{state.interval=Number($('#candle-resolution').value);renderChart();if(market())loadCandles(market().id,{force:true});});
$('#older-candles').addEventListener('click',()=>{const cache=state.candles.get(`${key(state.market)}:${state.interval}`);if(cache?.beforeCursor)loadCandles(state.market,{before:cache.beforeCursor,force:true});});
$('#latest-candles').addEventListener('click',()=>{if(market())loadCandles(market().id,{force:true});});
$('#depth-range').addEventListener('input',()=>{try{depthBounds(1,$('#depth-range').value);state.depthRange=Number($('#depth-range').value);renderChart();}catch{/* Keep the prior view while a custom number is incomplete. */}});
$('#depth-range').addEventListener('change',()=>{try{depthBounds(1,$('#depth-range').value);state.depthRange=Number($('#depth-range').value);renderChart();}catch(error){toast(error.message,'error');$('#depth-range').value=String(state.depthRange);}});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(market())renderChart();},100);});
document.addEventListener('change', async event => {
  const el = event.target;
  if(el.id==='funds-token'){state.fundsToken=el.value;try{await loadAsset(el.value);renderFunds();}catch(error){toast(error.message,'error');}return;}
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
$('#account').addEventListener('change',async()=>{try{await wallet.login($('#account').value);await syncAccount();await refresh();}catch(error){toast(error.message,'error');}});
$('#market-select').addEventListener('change', () => selectMarket($('#market-select').value));
$('#refresh').addEventListener('click', refresh);
$('#continue-funding').addEventListener('click',continueFunding);$('#cancel-funding').addEventListener('click',()=>{state.fundingContinue=null;renderFundingProgress();});
$('#more-markets').addEventListener('click',()=>loadMarkets(true));
$('#more-positions').addEventListener('click',()=>loadOwnPositions(true));
$('#refresh-positions').addEventListener('click',()=>loadOwnPositions());
for(const id of ['position-kind','position-market'])$('#'+id).addEventListener('change',()=>loadOwnPositions());
$('#more-assets').addEventListener('click',()=>loadAssets(true));$('#refresh-assets').addEventListener('click',()=>loadAssets());
$('#more-asks').addEventListener('click',()=>loadBookSide(false));$('#more-bids').addEventListener('click',()=>loadBookSide(true));
$('#refresh-depth').addEventListener('click',()=>{state.bookPages.clear();refresh();});
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#modal').close(); } });
document.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.classList.contains('book-row')) event.target.click(); });
$('#connection-banner').hidden = false;
initialize();
setInterval(() => { if (!state.pending && !state.fetches && !document.hidden) refresh(); }, 2000);
