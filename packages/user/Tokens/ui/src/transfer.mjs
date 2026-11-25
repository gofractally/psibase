import { getSupervisor, prompt } from '/wallet-assets/common-lib.js';

const supervisor = getSupervisor();
const el = (id) => document.getElementById(id);
const call = (method, params = []) => supervisor.functionCall({ service: 'tokens', intf: 'transfer-admin', method, params }, { enabled: false, returnPath: '/' });
let context;
function showError(error) {
  el('error').textContent = error?.message || String(error);
  el('error').hidden = false;
}
async function decide(approve) {
  el('approve').disabled = el('cancel').disabled = true;
  try {
    await call(approve ? 'approve' : 'deny', approve ? [context.requestId, el('remember').checked] : [context.requestId]);
    prompt.finished();
  } catch (error) {
    showError(error);
    el('approve').disabled = el('cancel').disabled = false;
  }
}
el('approve').addEventListener('click', () => decide(true));
el('cancel').addEventListener('click', () => decide(false));

try {
  context = JSON.parse(await call('getContext'));
  const operation = context.operation;
  if (!['credit', 'uncredit', 'debit'].includes(operation)) throw new Error('Unknown native transfer operation');
  const depositing = operation === 'credit';
  el('summary').textContent = depositing ? 'Authorize these wallet funds for the requesting app.' : 'Return these app funds to your wallet.';
  for (const id of ['amount', 'user', 'caller', 'memo']) el(id).textContent = context[id];
  el('symbol').textContent = context.symbol?.toUpperCase() || `Token #${context.tokenId}`;
  el('token').textContent = String(context.tokenId);
  el('from').textContent = depositing ? `${context.user} · wallet` : `${context.counterparty} · available funds`;
  el('to').textContent = depositing ? `${context.counterparty} · app balance` : `${context.user} · wallet`;
  el('trust-app').textContent = context.caller;
  // Native policy does not accept a remembered permission from the caller UI.
  el('remember').checked = false;
  el('details').hidden = false;
} catch (error) { showError(error); }
