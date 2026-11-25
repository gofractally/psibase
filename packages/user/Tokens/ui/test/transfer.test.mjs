import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/transfer.mjs', import.meta.url), 'utf8');
const nativeImport = "import { getSupervisor, prompt } from '/wallet-assets/common-lib.js';";
assert.ok(source.startsWith(nativeImport));
// Resolve only the browser's absolute native-client import. Execute the actual
// prompt module, including its event handlers and top-level context loading.
const executable = `(async () => {${source.replace(nativeImport, 'const { getSupervisor, prompt } = nativeClient;')}\n})()`;

const request = {
  requestId: '18446744073709551615', operation: 'credit',
  user: 'alice', caller: 'exchange', counterparty: 'exchange',
  amount: '184467440737.09551615', tokenId: 4294967295,
  symbol: 'usd', memo: 'Reviewed transfer',
};

async function fixture({ context = request, raw, loadError, decide = async () => {} } = {}) {
  const calls = [];
  let finished = 0;
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        textContent: '', hidden: ['details', 'error'].includes(id),
        disabled: false, checked: id === 'remember',
        set innerHTML(_) { throw new Error('Transfer data must never become HTML'); },
        addEventListener(type, listener) { listeners.set(type, listener); },
        click() { if (!this.disabled) return listeners.get('click')?.(); },
      });
    }
    return elements.get(id);
  };
  const nativeClient = {
    getSupervisor: () => ({
      async functionCall(args, options) {
        calls.push(JSON.parse(JSON.stringify({ args, options })));
        if (args.method === 'getContext') {
          if (loadError) throw loadError;
          return raw ?? JSON.stringify(context);
        }
        return decide(args.method, args.params);
      },
    }),
    prompt: { finished() { finished += 1; } },
  };
  await vm.runInNewContext(executable, { nativeClient, document: { getElementById: element } });
  return { element, calls, finished: () => finished };
}

test('native context preserves exact amounts and IDs and renders app text without HTML', async () => {
  const memo = '<img src=x onerror="steal()">';
  const f = await fixture({ context: { ...request, memo } });
  assert.deepEqual(f.calls, [{
    args: { service: 'tokens', intf: 'transfer-admin', method: 'getContext', params: [] },
    options: { enabled: false, returnPath: '/' },
  }]);
  assert.equal(f.element('amount').textContent, request.amount);
  assert.equal(f.element('token').textContent, '4294967295');
  assert.equal(f.element('symbol').textContent, 'USD');
  assert.equal(f.element('memo').textContent, memo);
  assert.equal(f.element('user').textContent, 'alice');
  assert.equal(f.element('caller').textContent, 'exchange');
  assert.equal(f.element('details').hidden, false);
  assert.equal(f.finished(), 0);
});

test('credit and return operations show the reviewed wallet and app fund direction', async () => {
  for (const operation of ['credit', 'uncredit', 'debit']) {
    const f = await fixture({ context: { ...request, operation } });
    const depositing = operation === 'credit';
    assert.equal(f.element('from').textContent, depositing ? 'alice · wallet' : 'exchange · available funds');
    assert.equal(f.element('to').textContent, depositing ? 'exchange · app balance' : 'alice · wallet');
    assert.match(f.element('summary').textContent, depositing ? /Authorize these wallet funds/ : /Return these app funds/);
  }
});

test('a symbol-less token retains its exact native token ID', async () => {
  const f = await fixture({ context: { ...request, symbol: null } });
  assert.equal(f.element('symbol').textContent, 'Token #4294967295');
});

test('remembered consent starts unchecked even when context contains a remember hint', async () => {
  const f = await fixture({ context: { ...request, remember: true } });
  assert.equal(f.element('remember').checked, false);
  assert.equal(f.element('trust-app').textContent, 'exchange');
  assert.equal(f.calls.length, 1);
});

test('one-time approval sends only the exact native review ID and explicit false consent', async () => {
  const f = await fixture();
  await f.element('approve').click();
  assert.deepEqual(f.calls[1], {
    args: { service: 'tokens', intf: 'transfer-admin', method: 'approve', params: [request.requestId, false] },
    options: { enabled: false, returnPath: '/' },
  });
  assert.equal(f.finished(), 1);
  assert.equal(f.element('approve').disabled, true);
  assert.equal(f.element('cancel').disabled, true);
});

test('remembered consent is transmitted only after the user checks the box', async () => {
  const f = await fixture();
  f.element('remember').checked = true;
  await f.element('approve').click();
  assert.deepEqual(f.calls[1].args.params, [request.requestId, true]);
  assert.equal(f.finished(), 1);
});

test('cancellation denies the exact review and never transmits remembered consent', async () => {
  const f = await fixture();
  f.element('remember').checked = true;
  await f.element('cancel').click();
  assert.deepEqual(f.calls[1].args, {
    service: 'tokens', intf: 'transfer-admin', method: 'deny', params: [request.requestId],
  });
  assert.equal(f.calls.filter(c => c.args.method === 'approve').length, 0);
  assert.equal(f.finished(), 1);
});

test('a pending decision disables both controls and prevents duplicate or opposite consent', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = await fixture({ decide: () => pending });
  const approval = f.element('approve').click();
  assert.equal(f.element('approve').disabled, true);
  assert.equal(f.element('cancel').disabled, true);
  await f.element('approve').click();
  await f.element('cancel').click();
  assert.equal(f.calls.length, 2);
  assert.equal(f.finished(), 0);
  resolve();
  await approval;
  assert.equal(f.finished(), 1);
});

test('rejected or unknown native decisions show an error without finishing or automatic retry', async () => {
  const error = '<script>stale review</script>';
  const f = await fixture({ decide: async () => { throw new Error(error); } });
  await f.element('approve').click();
  await new Promise(done => setImmediate(done));
  assert.equal(f.calls.length, 2);
  assert.equal(f.finished(), 0);
  assert.equal(f.element('error').textContent, error);
  assert.equal(f.element('error').hidden, false);
  assert.equal(f.element('approve').disabled, false);
  assert.equal(f.element('cancel').disabled, false);
});

test('failed context reads keep transfer details hidden and never stage consent', async () => {
  const f = await fixture({ loadError: new Error('selected account changed') });
  assert.equal(f.element('details').hidden, true);
  assert.equal(f.element('error').textContent, 'selected account changed');
  assert.equal(f.calls.length, 1);
  assert.equal(f.finished(), 0);
});

test('malformed contexts and unsupported operations cannot appear as a transfer review', async () => {
  for (const raw of ['not JSON', 'null', JSON.stringify({ ...request, operation: 'issue' })]) {
    const f = await fixture({ raw });
    assert.equal(f.element('details').hidden, true);
    assert.equal(f.element('error').hidden, false);
    assert.ok(f.element('error').textContent);
    assert.equal(f.calls.length, 1);
    assert.equal(f.finished(), 0);
  }
});
