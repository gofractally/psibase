import { test, expect } from './test.mjs';
import { sharedNative, appUrl } from './shared-native.mjs';

test.describe('Other production application landings — native/service fixtures', () => {
  test('Fractals offers its account connection gate', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('fractals'));
    await expect(page.getByText('The fractals app allows users to create fractals and participate in fractal governance.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
    await native.clean();
  });

  test('FractalCore renders a configured fractal and requires login', async ({ page }) => {
    const native = await sharedNative(page, {
      'fractals/plugin/authorized/graphql': ([query]) => {
        expect(query).toContain('fractal(fractal: "demo-frac")');
        return JSON.stringify({ data: { fractal: {
          account: 'demo-frac', name: 'Demo Fractal', mission: 'Build better communities together.',
          createdAt: '2026-11-23T00:00:00Z', stream: null, distIntervalSecs: 86400,
          genesisTime: '2026-11-23T00:00:00Z', judiciary: { occupation: 'judiciary', roleId: 1 },
          legislature: { occupation: 'legislator', roleId: 2 }, executive: { occupation: 'executive', roleId: 3 },
        } } });
      },
    });
    await page.goto(appUrl('demo-frac'));
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Login required', exact: true })).toBeVisible();
    await expect(page.getByText('Build better communities together.', { exact: true })).toBeVisible();
    await native.clean();
  });

  test('Identity renders its fixture graph and interactive controls', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('identity'));
    await expect(page.locator('svg#canvas')).toBeVisible();
    await expect.poll(() => page.locator('svg#canvas .node').count()).toBeGreaterThan(0);
    const attestations = page.locator('#show-attestations');
    await expect(attestations).toBeEnabled();
    await attestations.uncheck();
    await expect(attestations).not.toBeChecked();
    await native.clean();
  });

  test('Evaluations opens the new evaluation form without submitting it', async ({ page }) => {
    const native = await sharedNative(page);
    await page.goto(appUrl('evaluation'));
    await page.getByRole('button', { name: 'Create New Evaluation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Registration starts from', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await native.clean();
  });

  test('TokenStream loads an empty stream list and keeps creation behind login', async ({ page }) => {
    const native = await sharedNative(page);
    await page.route(appUrl('token-stream', '/graphql'), route => {
      expect(route.request().postDataJSON().query).toContain('streams');
      return route.fulfill({ json: { data: { streams: { nodes: [] } } } });
    });
    await page.goto(appUrl('token-stream'));
    await expect(page.getByText('Create and manage token streams', { exact: true })).toBeVisible();
    await expect(page.getByText('No streams', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create stream', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Log in to continue', exact: true })).toBeEnabled();
    await native.clean();
  });

  test('Explorer renders block data and navigates to the public block list', async ({ page }) => {
    const blocks = [2, 3].map((blockNum) => ({
      id: String(blockNum).padStart(64, '0'),
      header: { previous: '0'.repeat(64), blockNum, time: `2026-11-23T00:00:0${blockNum}Z`, producer: 'root', term: 1, commitNum: blockNum },
      transactions: [], actionsReceived: [],
    }));
    const native = await sharedNative(page, {
      'explorer/plugin/network/getNetworkName': 'Testnet',
      'explorer/plugin/network/getInstalledPackages': [],
      'explorer/plugin/block-log/getBlocks': ([range]) => JSON.stringify({
        edges: (range.gt ? [] : blocks).map(node => ({ node, cursor: String(node.header.blockNum) })),
        pageInfo: { hasPreviousPage: false, hasNextPage: false, startCursor: '2', endCursor: '3' },
      }),
      'explorer/plugin/producers/graphql': JSON.stringify({ data: {
        producers: [{ name: 'root', auth: { service: 'verify-sig', rawData: '' } }], nextProducers: [],
        consensus: { cft: [{ name: 'root' }] }, nextConsensus: null, jointStart: null,
      } }),
    });
    await page.goto(appUrl('explorer'));
    await expect(page.getByRole('heading', { name: 'Network overview', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '#3', exact: true }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Blocks', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Blocks', exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByRole('link', { name: '2', exact: true })).toBeVisible();
    await native.clean();
  });

  test('Plugin tester loads an origin service schema and exposes its methods', async ({ page }) => {
    const schema = {
      worlds: [{ name: 'root', exports: { api: { interface: { id: 0 } } } }],
      interfaces: [{ name: 'api', functions: { ping: { name: 'ping', params: [] } } }], types: [],
    };
    const native = await sharedNative(page, { '@getJson/demoapp/plugin': JSON.stringify(schema) });
    await page.route('**/common/thisservice', route => route.fulfill({ json: 'demoapp' }));
    await page.goto(appUrl('plugin-tester'));
    await expect(page.getByRole('button', { name: 'Connect account', exact: true })).toBeEnabled();
    await expect(page.getByPlaceholder('Service name')).toHaveValue('demoapp');
    await expect(page.getByRole('button', { name: 'Download JSON', exact: true })).toBeVisible();
    await page.getByText('Api', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'ping', exact: true })).toBeVisible();
    await native.clean();
  });
});
