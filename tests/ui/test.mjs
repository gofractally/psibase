import { test as base, expect } from '@playwright/test';

// This suite may run beside a developer's funded local chain. Native fixtures
// must never accidentally fall through to that chain or an external service.
export const test = base.extend({
  isolatedNetwork: [async ({ context }, use) => {
    const denied = [];
    const port = process.env.PSIBASE_UI_TEST_PORT || '4179';
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
      if (url.protocol === 'http:' && url.port === port && local) return route.fallback();
      denied.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => {
      denied.push(socket.url());
      socket.close();
    });
    await use();
    expect(denied, 'No unexpected external, live-chain, or WebSocket requests').toEqual([]);
  }, { auto: true }],
});
export { expect };
