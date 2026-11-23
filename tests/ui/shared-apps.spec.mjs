import { test, expect } from './test.mjs';
import { sharedNative, appUrl } from './shared-native.mjs';

test.describe('Shared production UI — real bundles with native RPC fixtures', () => {
  test('Homepage renders public apps and protects the Wallet and Marketplace routes', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('network'));
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
    await page.goto(appUrl('network', '/tokens'));
    await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();
    await expect(page.getByText('Sign in to use Wallet.', { exact: true })).toBeVisible();
    await page.goto(appUrl('network', '/account-marketplace'));
    await expect(page.getByText(/Sign in to use/)).toBeVisible();
    await native.clean();
  });

  test('Login prompt renders account import and can open account creation', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('login', '/plugin/web/prompt/import'));
    await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Account name', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Create a Testnet account', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
    await native.clean();
  });

  test('Account creation gates key confirmation and imports the reviewed credentials through Host', async ({ page }) => {
    const account = 'browserqa';
    const key = '-----BEGIN PRIVATE KEY-----\nYnJvd3Nlci10ZXN0LW9ubHk=\n-----END PRIVATE KEY-----';
    let created = false;
    const native = await sharedNative(page, {
      'accounts/query/api/getAccount': () => created ? { accountNum: '123', authService: 'auth-sig' } : undefined,
      'host/login-prompt/api/createAccount': params => {
        expect(params).toEqual([account]);
        created = true;
        return key;
      },
      'host/accounts/admin/importExisting': params => {
        expect(params).toEqual([[{ account, key }]]);
      },
      'host/login-prompt/api/connectAccount': params => {
        expect(params).toEqual([account]);
      },
    });
    await page.goto(appUrl('login', '/plugin/web/prompt/create'));
    await page.getByRole('textbox', { name: 'Account name', exact: true }).fill(account);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Secure your Testnet account', { exact: true })).toBeVisible();
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(next).toBeDisabled();
    await page.getByRole('checkbox').check();
    await next.click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await expect(page.locator('input[type=password]')).toHaveValue('');
    expect(native.calls.filter(call => call.method === 'createAccount')).toHaveLength(1);
    expect(native.calls.some(call => call.method === 'importExisting')).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Account name', exact: true })).toHaveValue(account);
    await page.locator('input[type=password]').fill('YnJvd3Nlci10ZXN0LW9ubHk=');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => native.calls.filter(call => call.method === 'importExisting').length).toBe(1);
    await expect.poll(() => native.calls.filter(call => call.method === 'connectAccount').length).toBe(1);
    await native.clean();
  });

  test('Config and Workshop render their signed-out landing pages', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('config'));
    await expect(page.getByText('Live network administration.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled();
    await page.goto(appUrl('workshop'));
    await expect(page.getByText('Login to continue', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled();
    await native.clean();
  });

  test('Permissions explains that approvals open from another app', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('permissions'));
    await expect(page.getByText(/This app displays permission request prompts from other apps for your approval/)).toBeVisible();
    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    await native.clean();
  });

  test('Homepage Wallet loads signed-in assets, navigates pending transfers, and cancels an auto-debit change', async ({ page }) => {
    const native = await sharedNative(page, {
      'host/accounts/api/getCurrentUser': 'alice',
      'homepage/plugin/tokens/getSystemToken': undefined,
      'homepage/plugin/tokens/getUserBalances': [],
      'homepage/plugin/chainmail/getMsgs': [],
      'homepage/plugin/tokenSwap/graphql': ([query]) => {
        expect(query).toContain('allPools');
        return JSON.stringify({ data: { allPools: { nodes: [] } } });
      },
      'homepage/plugin/tokens/graphql': ([query]) => {
        if (query.includes('userPending(')) return JSON.stringify({ data: { userPending: { nodes: [] } } });
        if (query.includes('userTokensWithActivity(')) return JSON.stringify({ data: { userTokensWithActivity: [] } });
        if (query.includes('userSettings(')) return JSON.stringify({ data: { userSettings: { settings: { autoDebit: false } } } });
        throw new Error(`Unmocked Wallet GraphQL query: ${query}`);
      },
    });
    await page.route(appUrl('profiles', '/graphql'), route => {
      expect(route.request().postDataJSON().query).toContain('profile(account: "alice")');
      return route.fulfill({ json: { data: { profile: { account: 'alice', displayName: 'Alice', bio: '' } } } });
    });
    await page.goto(appUrl('homepage', '/tokens'));
    await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();
    await expect(page.getByText('No token activity yet', { exact: true })).toBeVisible();
    await expect(page.getByText('Nothing to send', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Wallet sections' }).getByRole('link', { name: 'Pending', exact: true }).click();
    await expect(page.getByText('Nothing pending', { exact: true })).toBeVisible();
    await page.getByRole('switch', { name: 'Auto debit', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Turn Auto Debit On?', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('switch', { name: 'Auto debit', exact: true })).not.toBeChecked();
    expect(native.calls.some(call => call.method === 'enableUserAutoDebit')).toBe(false);
    await native.clean();
  });
});
