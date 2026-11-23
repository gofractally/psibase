import { test, expect } from './test.mjs';
import { installExchangeFixture } from './fixtures/exchange.mjs';

// Real production HTML/CSS/modules in Chromium; only native transports are
// mocked. Actual wallet prompts, chain custody/signatures and server CORS
// require the separate native integration tests.
test.describe('Exchange browser contracts with mocked native RPC', () => {
  let fixture;
  test.beforeEach(async ({ page }) => {
    fixture = await installExchangeFixture(page);
    await page.goto('/exchange/');
    await expect(page.locator('#account-name')).toHaveText('@alice');
    await expect(page.locator('#chain-status')).toContainText('Psibase connected');
    await expect(page.locator('#spot-form')).toBeVisible();
  });
  test.afterEach(async () => { if (fixture) expect(fixture.errors).toEqual([]); });

  test('renders actual book DOM, hourly/daily candles with volume, and symmetric depth zoom', async ({ page }) => {
    await expect(page.locator('#ticker-price')).toHaveText('57,000');
    await expect(page.locator('#asks .book-row')).toHaveCount(1);
    await expect(page.locator('#bids .book-row')).toHaveCount(1);
    await expect(page.getByRole('img', { name: '5-second trading candlesticks' })).toBeVisible();
    await page.getByLabel('Candle interval').selectOption('3600');
    await expect(page.getByRole('img', { name: 'Hourly trading candlesticks' })).toBeVisible();
    await expect(page.locator('#depth-chart')).toContainText('Volume BTC');
    await page.getByLabel('Candle interval').selectOption('86400');
    await expect(page.getByRole('img', { name: 'Daily trading candlesticks' })).toBeVisible();
    expect(fixture.queries.some(query => query.includes('interval=3600'))).toBe(true);
    expect(fixture.queries.some(query => query.includes('interval=86400'))).toBe(true);
    await page.locator('[data-chart="depth"]').click();
    await expect(page.getByRole('img', { name: 'Current buy and sell market depth' })).toBeVisible();
    await page.getByLabel('Depth range percentage').fill('0.5');
    await expect(page.locator('.chart-foot')).toContainText('−0.5%');
    await expect(page.locator('.chart-foot')).toContainText('+0.5%');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(page.getByLabel('Depth range percentage')).toHaveValue('0.25');
    await expect(page.locator('#depth-chart')).toContainText('57,000');
    await expect(page.getByText('Limit Price Pools', { exact: false })).toHaveCount(0);
  });

  test('places and cancels a limit order with exact native atoms and reviewed owner', async ({ page }) => {
    await page.locator('[data-type="limit"]').click();
    await page.locator('#spot-form input[name="price"]').fill('55000');
    await page.locator('#spot-form input[name="amount"]').fill('0.0001');
    await expect(page.locator('#order-estimate')).toContainText('5.5 USD');
    await page.locator('#spot-form button[type="submit"]').click();
    await expect(page.locator('#order-count')).toHaveText('2');
    const placed = fixture.calls.find(call => call.args.method === 'execute' && call.args.params[0] === 'limit');
    expect(placed.args.params).toEqual(['limit', JSON.stringify({ market: '1', bid: true, price: '55000', amount: '55000' }), 'alice', undefined]);
    expect(placed.options.enabled).toBe(false);
    const row = page.locator('#orders-content tr').filter({ hasText: '55,000' });
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#order-count')).toHaveText('1');
    const cancelled = fixture.calls.find(call => call.args.method === 'execute' && call.args.params[0] === 'cancel');
    expect(JSON.parse(cancelled.args.params[1])).toEqual({ market: '1', price: '55000', bid: true });
    expect(fixture.wallets.alice.balances[1].outgoing).toBe('1000000000');
  });

  test('rejects invalid financial precision before any native submission', async ({ page }) => {
    await page.locator('[data-type="limit"]').click();
    await page.locator('#spot-form input[name="amount"]').fill('0.000000001');
    await page.locator('#spot-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('at most 8 decimal places');
    expect(fixture.calls.filter(call => call.args.intf === 'user')).toHaveLength(0);
  });

  test('submits margin, lending and relay liquidity from ordinary asset amounts', async ({ page }) => {
    await page.locator('[data-ticket="margin"]').click();
    await expect(page.locator('#margin-form')).toBeVisible();
    await page.locator('#margin-form input[name="price"]').fill('45000');
    await page.locator('#margin-form input[name="collateral"]').fill('0.0002');
    await expect(page.locator('#order-estimate')).toContainText('4.455 USD');
    await page.locator('#margin-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('Open margin loan confirmed');
    const borrowed = fixture.calls.find(call => call.args.method === 'execute' && call.args.params[0] === 'borrow');
    expect(JSON.parse(borrowed.args.params[1])).toEqual({ market: '1', long: true, price: '45000', units: '1' });
    await page.locator('[data-view="lend"]').click();
    await page.locator('#lend-form input[name="amount"]').fill('1.2345');
    await page.locator('#lend-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('Supply lending vault confirmed');
    expect(JSON.parse(fixture.calls.find(call => call.args.params?.[0] === 'lend').args.params[1])).toEqual({ market: '1', base: false, amount: '12345' });
    await page.locator('#liquidity-form input[name="amount"]').fill('0.0001');
    await page.locator('#liquidity-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('Add relay liquidity confirmed');
    expect(JSON.parse(fixture.calls.find(call => call.args.params?.[0] === 'addliq').args.params[1])).toEqual({ market: '1', shares: '100' });
    for (const action of ['borrow', 'lend', 'addliq']) expect(fixture.calls.filter(call => call.args.method === 'execute' && call.args.params[0] === action)).toHaveLength(1);
  });

  test('routes deposit to Tokens and withdraw to the owner-bound native Exchange request', async ({ page }) => {
    await page.locator('[data-ticket="deposit"]').click();
    await expect(page.locator('#funds-form')).toBeVisible();
    await expect(page.locator('#funds-form')).toContainText('Trust exchange');
    await expect(page.locator('#funds-token')).toHaveValue('2');
    await page.locator('#funds-form input[name="amount"]').fill('1.2345');
    await page.getByRole('button', { name: 'Continue to Tokens', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Deposit USD confirmed');
    const deposit = fixture.calls.find(call => call.args.service === 'tokens' && call.args.method === 'credit');
    expect(deposit.args.params).toEqual([2, 'exchange', '1.2345', 'Exchange deposit', 'alice']);
    await page.locator('[data-ticket="withdraw"]').click();
    await page.locator('#funds-form input[name="amount"]').fill('0.2345');
    await page.locator('#funds-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('Withdraw USD confirmed');
    expect(fixture.calls.find(call => call.args.method === 'withdraw').args.params).toEqual([2, '2345', 'alice', undefined]);
    expect(fixture.wallets.alice.balances[1].wallet).toBe('7999990000');
  });

  test('keeps assets, transfer history, positions and trust scoped when switching accounts', async ({ page }) => {
    fixture.permissions.alice = true;
    await page.locator('#account-button').click();
    await expect(page.locator('#balances')).toContainText('100,000');
    await page.locator('[data-account-tab="positions"]').click();
    await expect(page.locator('#own-position-rows')).toContainText('58,000');
    await page.locator('[data-account-tab="history"]').click();
    await expect(page.locator('#transfer-history')).toContainText('alice test deposit');
    await page.locator('[data-account-tab="security"]').click();
    await expect(page.locator('#trust-status')).toContainText('Exchange is trusted');
    await page.locator('#revoke-trust').click();
    await expect(page.locator('#trust-status')).toContainText('Each transfer requires');
    expect(fixture.calls.some(call => call.args.service === 'tokens' && call.args.method === 'revokeTrust')).toBe(true);
    await page.locator('#account').selectOption('bob');
    await expect(page.locator('#account-identity')).toHaveText('@bob');
    await page.locator('[data-account-tab="assets"]').click();
    await expect(page.locator('#balances')).toContainText('200,000');
    await page.locator('[data-account-tab="positions"]').click();
    await expect(page.locator('#own-position-rows')).toContainText('59,000');
    await expect(page.locator('#own-position-rows')).not.toContainText('58,000');
    await page.locator('[data-account-tab="history"]').click();
    await expect(page.locator('#transfer-history')).toContainText('bob test deposit');
    await expect(page.locator('#transfer-history')).not.toContainText('alice test deposit');
  });

  test('keeps the mobile chart and account dialog inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#depth-chart svg')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#account-button').click();
    await expect(page.locator('#account-dialog')).toBeVisible();
    const box = await page.locator('#account-dialog').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('creates an independent funded market and selects the exact returned market', async ({ page }) => {
    await page.locator('.market-strip [data-open="create"]').click();
    await expect(page.locator('#create-form')).toBeVisible();
    await page.locator('#create-form input[name="base_amount"]').fill('0.1');
    await page.locator('#create-form input[name="quote_amount"]').fill('10000');
    await page.locator('#create-form button[type="submit"]').click();
    await expect(page.locator('#market-select')).toHaveValue('2');
    await expect(page).toHaveURL(/market=2/);
    await expect(page.locator('#ticker-price')).toHaveText('100,000');
    const created = fixture.calls.find(call => call.args.method === 'execute' && call.args.params[0] === 'create');
    expect(JSON.parse(created.args.params[1])).toEqual({ base: 1, quote: 2, base_amount: '10000000', quote_amount: '100000000', base_lot: '10000', quote_tick: '1' });
  });

  test('logs out to a public book without retaining private orders', async ({ page }) => {
    await page.locator('#account-button').click();
    await page.locator('#logout').click();
    await expect(page.locator('#account-name')).toHaveText('Connect account');
    await expect(page.locator('#orders-content')).not.toContainText('58,000');
    await expect(page.locator('#ticket-content')).toContainText('Connect your Psibase account');
    await expect(page.locator('#asks .book-row')).toHaveCount(1);
    expect(fixture.current()).toBeNull();
  });
});

test('Exchange browser contract: late public candles survive an account snapshot reset', async ({ page }) => {
  const fixture = await installExchangeFixture(page, { holdAccounts: true });
  let releaseCandles;
  const candlesReady = new Promise(resolve => { releaseCandles = resolve; });
  await page.route(url => url.pathname === '/candles', async route => { await candlesReady; await route.fallback(); });
  await page.goto('/exchange/');
  // syncAccount clears the initial public snapshot before waiting for this RPC.
  await expect.poll(() => fixture.calls.some(call => call.args.method === 'getConnectedAccounts')).toBe(true);
  const response = page.waitForResponse(url => new URL(url.url()).pathname === '/candles');
  releaseCandles();
  await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  fixture.releaseAccounts();
  await expect(page.locator('#spot-form')).toBeVisible();
  await expect(page.getByRole('img', { name: '5-second trading candlesticks' })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});
