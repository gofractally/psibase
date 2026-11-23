import { test, expect } from './test.mjs';
import { appUrl } from './shared-native.mjs';

// Load the static production app. Supervisor, Ethereum wallet RPC and service
// reads are fixtures: these checks never sign, submit to a chain, or fetch an
// outside proof source.
async function ethBridgeFixture(page) {
  const native = [], ethereum = [], errors = [];
  let current = null, connected = false;
  const address = '0x' + '22'.repeat(20);
  const snapshot = {
    config: { chain_id: 1338, vault: '11'.repeat(20), token: 7, paused: false, fee_bps: 10, batch_size: 1 },
    relay: { paused: false, finalized_slot: 9000 },
    amounts: { withdrawal_fee: '1000' }, depositSelector: '13765838',
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  page.on('requestfailed', request => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
  await page.exposeFunction('__ethBridgeNative', ({ args, options }) => {
    native.push(structuredClone({ args, options }));
    const name = [args.service, args.plugin, args.intf, args.method].join('/');
    if (name === 'host/accounts/api/getCurrentUser') return current;
    if (name === 'host/accounts/activeApp/connectAccount') { connected = true; return; }
    if (name === 'host/accounts/activeApp/getConnectedAccounts') return connected ? ['alice'] : [];
    if (name === 'host/accounts/activeApp/login' && args.params.length === 1 && args.params[0] === 'alice') { current = 'alice'; return; }
    if (name === 'ethbridge/plugin/api/identity' && current) return JSON.stringify({ account: current, number: '123' });
    if (name === 'ethbridge/plugin/api/submit' && current) return JSON.stringify({ transaction_id: 'fixture-only' });
    const error = `Unmocked native call: ${name}`; errors.push(error); throw Error(error);
  });
  await page.exposeFunction('__ethBridgeEthereum', request => {
    ethereum.push(structuredClone(request));
    if (request.method === 'eth_chainId') return '0x53a';
    if (request.method === 'eth_requestAccounts') return [address];
    if (request.method === 'eth_getBalance') return '0xde0b6b3a7640000';
    const error = `Unmocked Ethereum wallet call: ${request.method}`; errors.push(error); throw Error(error);
  });
  await page.addInitScript(() => { window.ethereum = { request: request => window.__ethBridgeEthereum(request) }; });
  await page.route('**/common/common-lib.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      export const getSupervisor = () => ({ functionCall: (args, options) => window.__ethBridgeNative({args, options}) });
      export const isRedirectErrorObject = () => false;
      export const handlePluginUserPrompt = () => { throw Error('Unexpected prompt in mocked bridge contract'); };
    `,
  }));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === '/config.json') body = {};
    else if (url.pathname === '/snapshot') body = snapshot;
    else if (url.pathname === '/balance' && url.searchParams.get('owner') === 'alice') body = { units: '10000000' };
    else if (url.pathname === '/deposits') body = { rows: [{ id: '1', owner: 'alice', publisher: 'bob', credited: '10000000' }], next: null };
    else if (url.pathname === '/withdrawals') body = { rows: [{ id: '2', owner: 'alice', status: 0, amount: '800000', address: '44'.repeat(20) }], next: null };
    else if (url.pathname === '/batches') body = { rows: [{ nonce: '3', status: 1, signatures: [true, true, false], total: '800000', requests: [2] }], next: null };
    else return route.fallback();
    return route.fulfill({ json: body });
  });
  return { native, ethereum, errors };
}

test.describe('ETH Bridge static production UI with mocked native and Ethereum RPC', () => {
  let fixture;
  test.beforeEach(async ({ page }) => {
    fixture = await ethBridgeFixture(page);
    await page.goto(appUrl('ethbridge'));
    await expect(page.locator('#notice')).toHaveText('Ethereum chain 1338 · finalized beacon slot 9000');
    await expect(page.locator('#ethereum-balance')).toHaveText('1.00000000 ETH');
    await expect(page.locator('#rows')).toContainText('Deposit 1');
  });
  test.afterEach(async () => { if (fixture) expect(fixture.errors).toEqual([]); });

  test('renders native assets and navigates deposit, withdrawal and batch history', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'ETH Bridge', exact: true })).toBeVisible();
    await expect(page.locator('#psibase-balance')).toHaveText('Connect an account');
    await expect(page.locator('#rows')).toContainText('0.10000000 ETH credited to @alice');
    await page.locator('[data-page="withdrawals"]').click();
    await expect(page.locator('#rows')).toContainText('Withdrawal 2: queued');
    await page.locator('[data-page="batches"]').click();
    await expect(page.locator('#rows')).toContainText('Batch 3: finalized allocation');
    await expect(page.getByRole('link', { name: 'Open Psibase token wallet' })).toHaveAttribute('href', appUrl('tokens').slice(0, -1));
    expect(fixture.native.every(call => call.args.method === 'getCurrentUser')).toBe(true);
  });

  test('connects through native Host and logs in the sole connected account', async ({ page }) => {
    await page.locator('#connect').click();
    await expect(page.locator('#identity')).toHaveText('@alice');
    await expect(page.locator('#psibase-balance')).toHaveText('0.10000000 ETH');
    await expect(page.locator('#connect')).toHaveText('Switch Psibase account');
    const login = fixture.native.filter(call => call.args.method === 'login');
    expect(login).toHaveLength(1);
    expect(login[0]).toEqual({ args: { service: 'host', plugin: 'accounts', intf: 'activeApp', method: 'login', params: ['alice'] }, options: { enabled: false, returnPath: '/' } });
    expect(fixture.native.filter(call => call.args.method === 'connectAccount')).toHaveLength(1);
    expect(fixture.native.filter(call => call.args.method === 'identity')).toHaveLength(1);
  });

  test('composes one exact native withdrawal authorization including its service fee', async ({ page }) => {
    await page.locator('#withdraw-form input[name="address"]').fill('0x' + '44'.repeat(20));
    await page.locator('#withdraw-form input[name="amount"]').fill('0.008');
    await page.locator('#withdraw-form button').click();
    await expect(page.locator('#message')).toContainText('Withdrawal authorized.');
    const submissions = fixture.native.filter(call => call.args.method === 'submit');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].options).toEqual({ enabled: false, returnPath: '/' });
    expect(JSON.parse(submissions[0].args.params[0])).toEqual([
      { sender: 'alice', service: 'tokens', method: 'credit', data: { token_id: 7, debitor: 'ethbridge', amount: { value: 801000 }, memo: 'ETH withdrawal authorization' } },
      { sender: 'alice', service: 'ethbridge', method: 'withdraw', data: { address: '44'.repeat(20), amount: 800000 } },
    ]);
    expect(fixture.ethereum.some(call => call.method === 'eth_sendTransaction')).toBe(false);
  });

  test('rejects excess precision before submitting a native withdrawal', async ({ page }) => {
    await page.locator('#withdraw-form input[name="amount"]').fill('0.000000001');
    await page.locator('#withdraw-form button').click();
    await expect(page.locator('#message')).toHaveText('Enter ETH with at most eight decimals.');
    expect(fixture.native.some(call => call.args.method === 'submit')).toBe(false);
  });
});
