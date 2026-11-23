// Browser contract fixture only. This replaces Supervisor/native HTTP transport;
// it does not execute a Psibase transaction or prove on-chain authorization.
export const tokens = [
  { id: 1, symbol: 'btc', precision: 8 },
  { id: 2, symbol: 'usd', precision: 4 },
];
export const market = {
  id: '1', base: 1, quote: 2, base_lot: '10000', quote_tick: '1',
  x: '10000000000', y: '57000000000', k: '570000000000000000000',
  lp_supply: '100000000', margin_enabled: true, fee_bps: 100,
  escrow_base: { funded: true }, escrow_quote: { funded: true },
  vault_base: '100000000', vault_quote: '1000000000',
  lending_base: '100000000', lending_quote: '1000000000',
  debt_base: '0', debt_quote: '0', maturity: '1800000000',
};

const clone = value => structuredClone(value);

export async function installExchangeFixture(page, { account = 'alice', trusted = false, holdAccounts = false } = {}) {
  const calls = [], queries = [], errors = [];
  let current = account;
  const accounts = ['alice', 'bob'];
  const markets = [clone(market)];
  let releaseAccounts;
  const accountsReady = holdAccounts ? new Promise(resolve => { releaseAccounts = resolve; }) : Promise.resolve();
  const wallets = Object.fromEntries(accounts.map((owner, index) => [owner, {
    owner, markets: [clone(market)], tokens: clone(tokens),
    balances: [
      { token: 1, wallet: '800000000', outgoing: index ? '200000000' : '100000000', incoming: '0', auto_debit: false },
      { token: 2, wallet: '8000000000', outgoing: index ? '2000000000' : '1000000000', incoming: '0', auto_debit: false },
    ],
    levels: [
      { market: '1', generation: '21', bid: true, price: '56000', outgoing: '5600000', shares: '5600000', active: true },
      { market: '1', generation: '22', bid: false, price: '58000', outgoing: '1000000', shares: '1000000', active: true },
    ],
    positions: [{ owner, market: '1', generation: String(22 + index), bid: false, price: String(58000 + index * 1000), shares: '1000000', refund: '1000000', remaining_outgoing: '1000000', remaining_base: '1000000', proceeds: '0', active: true }],
    loans: [], loan_positions: [], stop_positions: [], lenders: [], relay_shares: [],
    continuations: {}, coverage_complete: true,
  }]));
  const permissions = { alice: trusted, bob: false };
  let nextGeneration = 100;
  const balance = token => wallets[current].balances.find(row => row.token === token);
  const json = value => JSON.stringify(value);
  const result = () => json({ status: 'executed', executed: true, prepared: 0, funding_cursor: null });

  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('requestfailed', request => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
  await page.exposeFunction('__exchangeRpc', async ({ args, options }) => {
    calls.push(clone({ args, options }));
    try {
    const { service, intf, method, params = [] } = args;
    if (service === 'host' && args.plugin === 'accounts') {
      if (intf === 'api' && method === 'getCurrentUser') return current;
      if (intf === 'activeApp' && method === 'getConnectedAccounts') { await accountsReady; return accounts; }
      if (intf === 'activeApp' && method === 'login') { current = params[0]; return; }
      if (intf === 'activeApp' && method === 'logout') { current = null; return; }
      if (intf === 'activeApp' && method === 'connectAccount') { current ||= 'alice'; return; }
    }
    if (service === 'tokens' && args.plugin === 'plugin' && intf === 'transfer') {
      if (method === 'trustStatus') return permissions[current] || false;
      if (method === 'revokeTrust') { permissions[current] = false; return; }
      if (method === 'approvalStatus') return 'approved';
      if (method === 'credit') {
        if (params[1] !== 'exchange' || params[4] !== current) throw Error('Fixture rejected wrong transfer owner/counterparty');
        const precision = tokens.find(t => t.id === params[0]).precision;
        const [whole, fraction = ''] = params[2].split('.');
        const amount = BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'));
        const row = balance(params[0]); row.wallet = String(BigInt(row.wallet) - amount); row.outgoing = String(BigInt(row.outgoing) + amount);
        return;
      }
    }
    if (service === 'exchange' && args.plugin === 'plugin' && intf === 'queries') {
      const state = wallets[current];
      if (method === 'scopedSnapshot' || method === 'snapshot') return json(state);
      if (method === 'assets' || method === 'asset') return json({ owner: current, tokens, balances: method === 'asset' ? state.balances.filter(row => row.token === params[0]) : state.balances, next_after: null });
      if (method === 'positions') return json({ owner: current, tokens, markets: [market], loans: [], rows: params[0] === 'orders' ? state.positions : [], next_after: null });
      if (method === 'history') return json({ data: { balChanges: {
        edges: [{ node: { account: current, counterParty: 'exchange', tokenId: params[0], action: 'credited', amount: current === 'alice' ? '12.3456' : '99.0000', memo: `${current} test deposit`, block: { blockNum: 100, blockTime: '2026-11-23T00:00:00Z' } } }],
        pageInfo: { hasPreviousPage: false, startCursor: null },
      } } });
      if (method === 'stops') return json({ owner: current, stop_positions: [], next_before: null });
    }
    if (service === 'exchange' && args.plugin === 'plugin' && intf === 'user') {
      if (!['execute', 'withdraw'].includes(method)) throw Error(`Unmocked native method: exchange/user/${method}`);
      const expectedOwner = params[2];
      if (expectedOwner !== current) throw Error('Fixture rejected stale owner');
      if (method === 'withdraw') {
        const row = balance(params[0]), amount = BigInt(params[1]);
        row.wallet = String(BigInt(row.wallet) + amount); row.outgoing = String(BigInt(row.outgoing) - amount);
      }
      if (method === 'execute') {
        const [action, input] = params, data = JSON.parse(input), state = wallets[current];
        if (action === 'create') {
          const created = { ...clone(market), id: String(markets.length + 1), base: data.base, quote: data.quote, base_lot: data.base_lot, quote_tick: data.quote_tick, x: data.base_amount, y: data.quote_amount, k: String(BigInt(data.base_amount) * BigInt(data.quote_amount)) };
          markets.push(created);
          for (const wallet of Object.values(wallets)) wallet.markets.push(clone(created));
          return json({ status: 'executed', executed: true, prepared: 0, trace: { actionTraces: [{ retval: created.id }] } });
        } else if (action === 'limit') {
          const outgoing = BigInt(data.amount), base = data.bid ? outgoing * 10000n / BigInt(data.price) : outgoing;
          state.positions.push({ owner: current, market: data.market, generation: String(nextGeneration++), bid: data.bid, price: data.price, shares: data.amount, refund: data.amount, remaining_outgoing: data.amount, remaining_base: String(base), proceeds: '0', active: true });
          const row = balance(data.bid ? 2 : 1); row.outgoing = String(BigInt(row.outgoing) - outgoing);
        } else if (action === 'cancel') {
          const position = state.positions.find(row => row.market === data.market && row.bid === data.bid && row.price === data.price);
          if (!position) throw Error('Fixture order missing');
          const row = balance(data.bid ? 2 : 1); row.outgoing = String(BigInt(row.outgoing) + BigInt(position.refund));
          state.positions = state.positions.filter(row => row !== position);
        } else if (!['borrow', 'lend', 'addliq'].includes(action)) throw Error(`Unmocked Exchange action: ${action}`);
      }
      return result();
    }
    throw Error(`Unmocked native call: ${service}/${intf}/${method}`);
    } catch (error) {
      // UI catch handlers may render a toast rather than throw a page error.
      // Unexpected transport calls must still fail the browser contract.
      errors.push(`Native fixture rejected: ${error.message}`);
      throw error;
    }
  });
  await page.route('**/common/common-lib.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const getSupervisor = () => ({ functionCall: (args, options) => window.__exchangeRpc({args, options}) });
    export const siblingUrl = (_, service, path = '/') => 'http://' + service + '.example.test' + path;
    export const isRedirectErrorObject = () => false;
    export const handlePluginUserPrompt = () => { throw Error('Unexpected native prompt in mock browser contract'); };
  ` }));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!['/markets', '/market', '/book', '/candles', '/trades', '/api/tokens'].includes(path)) return route.fallback();
    queries.push(path + url.search);
    let body;
    if (path === '/markets') body = { markets, tokens, next_after: null };
    else if (path === '/market') body = { market: markets.find(row => row.id === url.searchParams.get('market')) || null, tokens };
    else if (path === '/book') body = { levels: wallets.alice.levels.filter(row => String(row.bid) === url.searchParams.get('bid')), next_after: null };
    else if (path === '/api/tokens') body = { tokens, next_after: null };
    else if (path === '/trades') body = { trades: [], next_after: null };
    else {
      const interval = Number(url.searchParams.get('interval'));
      body = { interval, price_precision: 4, next_before: null, candles: [1, 2, 3].map(index => ({
        time: interval * index, open: '569000000', high: '572000000', low: '568000000', close: '570000000', volume: String(index * 1000000), trades: '2', complete: true,
      })) };
    }
    return route.fulfill({ contentType: 'application/json', body: json(body) });
  });
  return { calls, queries, errors, wallets, permissions, releaseAccounts: () => releaseAccounts?.(), current: () => current };
}
