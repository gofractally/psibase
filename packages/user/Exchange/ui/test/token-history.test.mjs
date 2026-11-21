import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferHistory } from '../src/token-history.js';
const context={owner:'alice',tokenId:1,precision:8};
const node=(amount,extra={})=>({account:'alice',counterParty:'exchange',tokenId:1,action:'credited',amount,memo:'Exchange deposit',...extra});
const page=nodes=>({data:{balChanges:{edges:nodes.map(node=>({node})),pageInfo:{hasPreviousPage:true,startCursor:'native-cursor'}}}});
test('native history decimal strings stay exact and display newest first',()=>{
  const result=transferHistory(page([node('90071992.54740993'),node('0.00000001',{action:'uncredited'})]),context);
  assert.deepEqual(result.rows.map(r=>[r.label,r.amount]),[['Withdrawal','0.00000001'],['Deposit','90,071,992.54740993']]);
  assert.equal(result.before,'native-cursor');
});
test('a transfer history page cannot include another account, counterparty or token',()=>{
  for(const change of [{account:'bob'},{counterParty:'notexchange'},{tokenId:2}])assert.throws(()=>transferHistory(page([node('1',change)]),context),/did not match/);
  assert.throws(()=>transferHistory(page([node('1e8')]),context));
  assert.throws(()=>transferHistory({errors:[{message:'authenticated user required'}]},context),/authenticated user required/);
});
