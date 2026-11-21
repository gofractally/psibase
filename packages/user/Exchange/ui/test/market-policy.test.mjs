import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditStatus, fundingPaused } from '../src/market-policy.js';

const funded = { escrow_base: { funded: true }, escrow_quote: { funded: true } };
test('credit controls require sticky native eligibility and verified backing', () => {
  assert.equal(creditStatus({ ...funded, margin_enabled: true }).enabled, true);
  assert.equal(creditStatus({ ...funded, margin_enabled: false }).enabled, false);
  assert.equal(creditStatus({ ...funded }).enabled, false);
  assert.equal(creditStatus({ margin_enabled: true }).enabled, false);
  assert.equal(creditStatus({ margin_enabled: true, escrow_base: { funded: null }, escrow_quote: { funded: null } }).enabled, false);
});
test('native underfunding and legacy status pause new commitments', () => {
  const missing = { ...funded, margin_enabled: true, escrow_quote: { funded: false } };
  assert.equal(fundingPaused(missing), true);
  assert.equal(creditStatus(missing).enabled, false);
  assert.equal(creditStatus(missing).label, 'Funding paused');
  assert.equal(fundingPaused({ ...funded, legacy_unsupported: true }), true);
  assert.equal(fundingPaused({ ...funded, margin_enabled: false }), false);
});
