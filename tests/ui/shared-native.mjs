import { expect } from '@playwright/test';

// Exercise production bundles and their real Common API postMessage client.
// Only the native Supervisor iframe and service HTTP data are fixtures. This
// does not load private keys, run WASM plugins, sign, or submit transactions.
export async function sharedNative(page, overrides = {}) {
  const calls = [];
  const errors = [];
  const handlers = {
    'host/accounts/api/getCurrentUser': null,
    'host/accounts/activeApp/connectAccount': undefined,
    'branding/plugin/queries/getNetworkName': 'Testnet',
    'packages/plugin/queries/getInstalledPackages': [],
    'producers/plugin/authorized/graphql': JSON.stringify({ data: { producers: [] } }),
    'host/login-prompt/admin/getAllAccounts': [],
    'host/login-prompt/api/canCreateAccount': true,
    'host/login-prompt/api/canBuyAccount': false,
    'host/login-prompt/api/getSystemToken': undefined,
    ...overrides,
  };
  page.on('pageerror', error => errors.push(`Page error: ${error.message}`));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('requestfailed', request => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
  await page.exposeFunction('__sharedNativeCall', async request => {
    if (request.type === 'PRE_LOAD_PLUGINS_REQUEST') return null;
    if (request.type === 'GET_JSON_REQUEST') {
      const { service, plugin } = request.payload.plugin;
      const key = `@getJson/${service}/${plugin}`;
      if (Object.hasOwn(handlers, key)) {
        const result = handlers[key];
        return typeof result === 'function' ? result(request.payload.plugin) : result;
      }
      const message = `Unmocked plugin schema request: ${key}`;
      errors.push(message);
      return { name: 'GenericErrorObject', message };
    }
    if (request.type !== 'FUNCTION_CALL_REQUEST') {
      const message = `Unmocked native message: ${JSON.stringify(request)}`;
      errors.push(message);
      return { name: 'GenericErrorObject', message };
    }
    const args = request.args;
    calls.push(args);
    const key = [args.service, args.plugin || 'plugin', args.intf || '', args.method].join('/');
    if (!Object.hasOwn(handlers, key)) {
      const message = `Unmocked native call: ${key} ${JSON.stringify(args.params)}`;
      errors.push(message);
      return { name: 'GenericErrorObject', message };
    }
    const handler = handlers[key];
    try {
      return typeof handler === 'function' ? await handler(args.params, args) : handler;
    } catch (error) {
      const message = `Native fixture rejected ${key}: ${error.message}`;
      errors.push(message);
      return { name: 'GenericErrorObject', message };
    }
  });
  await page.route(`${appUrl('supervisor')}**`, route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><script>
      window.addEventListener('message', async event => {
        if (event.source !== parent) return;
        const result = await window.__sharedNativeCall(event.data);
        parent.postMessage({type:'FUNCTION_CALL_RESPONSE', id:event.data.id, result}, event.origin);
      });
      parent.postMessage({type:'SUPERVISOR_INITIALIZED', payload:{}}, '*');
    </script>`,
  }));
  await page.route(appUrl('branding', '/network_logo*'), route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#4183ff"/></svg>',
  }));
  await page.route('**/common/chainid', route => route.fulfill({ json: 'a'.repeat(64) }));
  await page.route(appUrl('profiles', '/avatar/*'), route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#4183ff"/></svg>',
  }));
  return {
    calls,
    errors,
    async clean() { expect(errors, 'No unmocked native calls, failed HTTP requests, or browser exceptions').toEqual([]); },
  };
}

export const appUrl = (service, path = '/') => `http://${service}.localhost:${process.env.PSIBASE_UI_TEST_PORT || 4179}${path}`;
