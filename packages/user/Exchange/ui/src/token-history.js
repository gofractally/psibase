import { atoms, decimal } from './amounts.js';

// Native Tokens history amounts are decimal strings, unlike snapshot atom
// quantities. Convert exactly once; never pass them through Number or BigInt
// as though the decimal text were an atom quantity.
export function transferHistory(result, { owner, tokenId, precision }) {
  if(result?.errors?.length)throw new Error(result.errors.map(e=>e.message).join(' '));
  const connection=result?.data?.balChanges||result?.balChanges;
  if(!connection||!Array.isArray(connection.edges))throw new Error('Native Tokens returned an invalid history page.');
  const labels={credited:'Deposit',uncredited:'Withdrawal',debited:'Received',rejected:'Returned',recalled:'Recalled',burned:'Burned'};
  const rows=[...connection.edges].reverse().map(({node})=>{
    if(node.account!==owner||node.counterParty!=='exchange'||String(node.tokenId)!==String(tokenId))throw new Error('History response did not match your connected account and asset.');
    return {label:labels[node.action]||'Transfer',amount:decimal(atoms(node.amount,precision,'History amount',true),precision),memo:String(node.memo||''),block:node.block||{}};
  });
  const info=connection.pageInfo||{};
  return {rows,before:info.hasPreviousPage&&typeof info.startCursor==='string'?info.startCursor:null};
}
