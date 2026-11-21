export interface ExplorerContext {
 state():any; account():string; request(url:string):Promise<any>;
 bitcoin(path:string,options?:RequestInit):Promise<any>; transact(actions:any[]):Promise<any>;
 syncHeaders():Promise<void>; complete(txid:string):Promise<void>; reload():Promise<void>;
 notify(message:string,error?:boolean):void; fmt(n:number):string; esc(value:unknown):string;
}
export function createExplorer(c:ExplorerContext){
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
 const esc=c.esc,btc=(n:number)=>`${c.fmt(n)} BTC`,short=(s:string)=>`${s.slice(0,12)}…${s.slice(-6)}`;
 const when=(n:number)=>n?new Date(n*1000).toLocaleString():'Earlier deposit';
 let view='batches',cursor:string|null=null,stack:(string|null)[]=[],next:string|null=null,filter='0',owner='',loading=false,generation=0,lastRefresh=0,lastMarkup='';
 let historyView='withdrawals',historyCursor:string|null=null,historyStack:(string|null)[]=[],historyNext:string|null=null,historyOwner='',historyGeneration=0,historyLoading=false,historyFetched=0;
 let detail:number|null=null,detailGeneration=0,operating=false;
 const observations=new Map<string,any>();
 const action=(method:string,data:any)=>({sender:c.account(),service:'btcbridge',method,data});
 function pill(text:string,complete=false){return `<span class="pill ${complete?'complete':''}">${esc(text)}</span>`;}
 function txLink(txid:string){return txid?`<button class="text-button mono" data-inspect-tx="${esc(txid)}" title="${esc(txid)}">${esc(short(txid))}</button>`:'—';}
 function observed(txid:string){return observations.get(txid);}
 function stage(b:any,t:any,revisions:any[]=[]){
  if(b.status===1)return 'Complete';if(c.state().commit_num<t.authorized_block)return 'Waiting for Psibase finality';
  const confirmed=revisions.find(r=>observed(r.txid)?.confirmed);const status=observed(confirmed?.txid||t.txid);
  if(status?.confirmed){const conf=Math.max(0,(status.tip||0)-(status.block_height||0)+1);return (conf>=c.state().relay.required?'Confirmed · awaiting proof':`Bitcoin confirmations · ${conf}/${c.state().relay.required}`)+(confirmed&&confirmed.revision!==t.revision?` · revision ${confirmed.revision}`:'');}
  if(status?.seen)return 'Broadcast · seen in Bitcoin mempool';
  if(t.ready&&status?.error)return 'Fully signed · Bitcoin source unavailable';if(t.ready)return status?.missing?'Fully signed · ready to broadcast':'Fully signed · broadcast not yet observed';
  if(t.published_signers?.length>=2)return 'Signatures published · waiting for collection';return `Gathering signatures · ${t.gathered.length}/2 collected`;
 }
 function withdrawalState(w:any,b:any){
  if(w.status===2)return 'Complete';if(w.status===3)return 'Cancelled';if(w.status===4)return 'Fee cap too low · cancel and retry';
  if(w.status===0){const s=c.state();return `Queued · batching every ${s.policy.batch_seconds/60} min or ${s.policy.batch_size} requests`;}
  return b?stage(b.batch,b.transaction,b.revisions):'Committed · inspecting batch';
 }
 function withdrawalRows(rows:any[]){return rows.map(({withdrawal:w,batch:b})=>`<tr><td>#${w.id}<small>@${esc(w.owner)}</small></td><td>${btc(w.amount)}<small>${w.status===2?`Network fee paid ${btc(w.paid_fee)} · returned ${btc(w.max_fee-w.paid_fee)}`:`Fee cap ${btc(w.max_fee)}`}</small></td><td class="wrap">${pill(withdrawalState(w,b),w.status===2)}${w.batch?`<a href="#explorer/batch/${w.batch}">Inspect batch #${w.batch}</a>`:''}</td><td class="wrap mono">${esc(w.address)}</td><td>${txLink(w.txid||b?.transaction.txid||'')}</td><td>${(w.status===0||w.status===4)&&w.owner===c.account()?`<button data-cancel-withdrawal="${w.id}" data-wallet-required>Cancel</button>`:''}</td></tr>`).join('');}
 function depositRows(rows:any[]){return rows.map(d=>`<tr><td>${txLink(d.txid)}<small>Output ${d.vout} · block ${d.height}</small></td><td>@${esc(d.owner)}<small>${when(d.credited_at)}</small></td><td>${btc(d.value)}<small>Credited ${btc(d.credited)}</small></td><td>${btc(d.fee)}<small>Publisher reward ${btc(d.bounty)}</small></td><td>${d.publisher?'@'+esc(d.publisher):'Not recorded'}<small>${d.legacy?'Earlier deposit · no bounty':`${d.fee_bps/100}% deposit fee`}</small></td></tr>`).join('');}
 function table(head:string[],body:string){return `<div class="table-scroll"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${head.length}" class="empty">No matching records.</td></tr>`}</tbody></table></div>`;}
 async function observe(txids:string[]){
  for(const txid of [...new Set(txids)].slice(0,10)){
   try{const info=await c.bitcoin(`/tx/${txid}`);const status={...info.status,seen:true,checked:Date.now()};if(status.confirmed)status.tip=Number(await c.bitcoin('/blocks/tip/height'));observations.set(txid,status);}
   catch(error){const missing=/not found|no such mempool|no such transaction|404/i.test((error as Error).message);observations.set(txid,{missing,error:!missing,checked:Date.now()});}
  }
 }
 function restoreDetails(host:HTMLElement,markup:string){const open=Array.from(host.querySelectorAll<HTMLDetailsElement>('details[open]')).map(d=>d.id);host.innerHTML=markup;for(const id of open){const node=document.getElementById(id) as HTMLDetailsElement|null;if(node)node.open=true;}}
 async function fetchList(){
  if(loading||!c.state())return;loading=true;const seq=++generation;
  try{
   const q=new URLSearchParams({limit:view==='batches'?'5':'25'});if(cursor)q.set('cursor',cursor);if(owner)q.set('owner',owner);
   if(view==='batches')q.set('status',filter==='all'?'all':filter);if(view==='utxos')q.set('status',filter);
   const result=await c.request(`/explorer/${view}?${q}`);if(seq!==generation)return;
   if(view==='batches')await observe(result.rows.filter((r:any)=>r.batch.status===0).flatMap((r:any)=>(r.revisions||[r.transaction]).map((v:any)=>v.txid)));
   if(view==='withdrawals')await observe(result.rows.filter((r:any)=>r.batch?.batch.status===0).flatMap((r:any)=>(r.batch.revisions||[r.batch.transaction]).map((v:any)=>v.txid)));
   if(seq!==generation)return;next=result.next;let markup='';
   if(view==='batches'){
    markup=result.rows.length?result.rows.map(({batch:b,transaction:t,revisions}:any)=>`<article class="batch-card"><div class="section-title"><h3>Batch #${b.id} <small>Revision ${b.current_revision}</small></h3>${pill(stage(b,t,revisions),b.status===1)}</div><p>${b.requests.length} withdrawals · ${t.input_count} inputs · Miner fee ${btc(t.fee)}</p><p>${txLink(t.txid)}</p><div class="buttons"><a class="button-link" href="#explorer/batch/${b.id}">Inspect transaction</a>${b.status===0&&t.ready?`<button class="primary" data-broadcast="${b.id}">Broadcast BTC now</button>`:''}</div></article>`).join(''):'<p class="empty">No pending transactions. Queued withdrawals form a batch when the time or request threshold is reached.</p>';
   }else if(view==='utxos'){
    markup=table(['Outpoint','Amount','State','Deposit account / derivation','Bitcoin block'],result.rows.map(({utxo:u,address:a}:any)=>`<tr><td>${txLink(u.txid)}<small>Output ${u.vout}</small></td><td>${btc(u.value)}</td><td>${pill(['Available','Reserved','Spent'][u.status])}${u.batch?`<a href="#explorer/batch/${u.batch}">Batch #${u.batch}</a>`:''}</td><td>${a?'@'+esc(a.owner):'Bridge change'}<small>Branch ${u.branch} / index ${u.index}</small></td><td>${u.height}<small class="mono" title="${esc(u.block)}">${esc(short(u.block))}</small></td></tr>`).join(''));
   }else if(view==='withdrawals')markup=table(['Withdrawal','Amount received','Waiting for','Bitcoin destination','Transaction',''],withdrawalRows(result.rows));
   else if(view==='deposits')markup=table(['Bitcoin transaction','Recipient','Deposited / credited','Fee / bounty','Proof publisher'],depositRows(result.rows));
   else markup=table(['Index','Psibase recipient','Public Bitcoin deposit address','Output script'],result.rows.map((a:any)=>`<tr><td>${a.index}</td><td>@${esc(a.owner)}</td><td class="mono wrap">${esc(a.address)}<button data-copy="${esc(a.address)}">Copy</button></td><td class="mono wrap">${esc(a.script)}</td></tr>`).join(''));
   if(markup!==lastMarkup){el('explorer-results').innerHTML=markup;lastMarkup=markup;}
   el<HTMLButtonElement>('explorer-prev').disabled=stack.length===0;el<HTMLButtonElement>('explorer-next').disabled=!next;
   el('explorer-page').textContent=`Page ${stack.length+1} · ${result.rows.length} records`;
   el('explorer-error').hidden=true;lastRefresh=Date.now();
  }catch(error){el('explorer-error').textContent=(error as Error).message;el('explorer-error').hidden=false;}finally{loading=false;if(seq!==generation&&detail===null&&!el('explorer-view').hidden)void fetchList();}
 }
 async function fetchHistory(force=false){
  if(historyLoading||!c.state())return;const account=c.account();
  if(account!==historyOwner){historyOwner=account;historyCursor=null;historyStack=[];historyFetched=0;}
  if(!account){el('history-results').innerHTML='<p class="empty">Connect your Psibase account to see your deposits and withdrawals.</p>';return;}
  if(!force&&Date.now()-historyFetched<10000)return;
  historyLoading=true;const seq=++historyGeneration;
  try{const q=new URLSearchParams({owner:account,limit:'10'});if(historyCursor)q.set('cursor',historyCursor);
   const result=await c.request(`/explorer/${historyView}?${q}`);if(account!==c.account()||seq!==historyGeneration)return;
   if(historyView==='withdrawals')await observe(result.rows.filter((r:any)=>r.batch?.batch.status===0).flatMap((r:any)=>(r.batch.revisions||[r.batch.transaction]).map((v:any)=>v.txid)));
   if(account!==c.account()||seq!==historyGeneration)return;
   historyNext=result.next;el('history-results').innerHTML=historyView==='deposits'?table(['Transaction','Recipient','Amount','Fee / bounty','Proof publisher'],depositRows(result.rows)):table(['Withdrawal','Amount received','Waiting for','Bitcoin destination','Transaction',''],withdrawalRows(result.rows));
   el<HTMLButtonElement>('history-prev').disabled=historyStack.length===0;el<HTMLButtonElement>('history-next').disabled=!historyNext;
   el('history-page').textContent=`Page ${historyStack.length+1}`;historyFetched=Date.now();
  }catch(error){el('history-results').textContent=(error as Error).message;}finally{historyLoading=false;}
 }
 async function fetchDetail(){
  if(detail===null)return;const id=detail,seq=++detailGeneration;
  try{const d=await c.request(`/explorer/batch?id=${id}`);await observe(d.revisions.map((r:any)=>r.txid));if(id!==detail||seq!==detailGeneration)return;
   const t=d.transaction,b=d.batch,confirmedRevision=d.revisions.find((r:any)=>observed(r.txid)?.confirmed),proofTxid=confirmedRevision?.txid||t.txid,status=observed(proofTxid),finished=b.status===1,confirmedEnough=!!status?.confirmed&&(status.tip-status.block_height+1)>=c.state().relay.required;
   const completeProviders=d.providers.filter((p:any)=>p.signed===p.total&&p.total>0).length;
   const overall=!finished&&confirmedRevision?stage(b,t,d.revisions):!finished&&c.state().commit_num<t.authorized_block?'Waiting for Psibase finality':!t.ready&&!finished?(completeProviders>=2?'Signatures published · ready to assemble':`Waiting for signatures · ${completeProviders}/2 complete signer responses (${d.available} custody providers)`):stage(b,t);
   const needsRequests=d.providers.some((p:any)=>p.requested<p.total),needsGather=d.providers.some((p:any)=>p.signed===p.total&&!p.gathered);
   const cards=d.providers.map((p:any)=>`<div class="signer-progress"><strong>Signer ${p.signer+1} · @${esc(p.provider)}</strong><span>${p.signed}/${p.total} input signatures published</span><small>${p.gathered?'Collected by bridge':p.signed===p.total?'Ready to collect':p.requested<p.total?'Signature requests still need publication':'Waiting for signing provider'}</small></div>`).join('');
   const inputRows=d.inputs.map(({input:i,signatures}:any,n:number)=>`<tr><td>${n} · ${txLink(i.txid)}<small>Output ${i.vout}</small></td><td>${btc(i.value)}</td><td>Branch ${i.branch} / index ${i.index}</td><td>${[0,1,2].map(s=>{const sig=signatures.find((r:any)=>r.signer===s);return `<small>Signer ${s+1}: ${sig?.published?'Signature published':sig?'Requested':'Not requested'}${sig?` · request #${sig.request}`:''}</small>`;}).join('')}</td></tr>`).join('');
   const revisions=d.revisions.map((r:any)=>`<tr><td>${r.revision}${r.revision===b.current_revision?' · current':''}</td><td>${txLink(r.txid)}</td><td>${btc(r.fee)}</td><td>${r.ready?'Fully signed':'Unsigned / collecting signatures'}</td></tr>`).join('');
   const markup=`<div class="section-title"><div><p class="eyebrow">WITHDRAWAL TRANSACTION</p><h2>Batch #${b.id} · revision ${t.revision}</h2></div><a href="#explorer/batches">Back to transactions</a></div><p class="pipeline-status">${esc(overall)}</p><p class="muted">${finished?'Bitcoin payment proved on Psibase.':`Two of three providers must sign every input. Publication, collection, broadcast, and the ${c.state().relay.required}-confirmation proof are separate steps.`}</p><p class="fine">${confirmedRevision&&confirmedRevision.revision!==t.revision?`The Bitcoin source reports revision ${confirmedRevision.revision} confirmed. Its proof can settle this batch; the newer revision does not need more signatures.`:''}</p><div class="buttons">${!finished&&!confirmedRevision&&t.ready?`<button class="primary" data-broadcast="${id}">Broadcast BTC now</button>`:''}${!finished&&!confirmedRevision&&(needsRequests||needsGather)?`<button data-collect="${id}" data-wallet-required ${!c.account()?'disabled':''}>${needsRequests?'Publish signature requests':'Collect published signatures'}</button>`:''}${!finished&&status?.confirmed?`<button data-complete-tx="${esc(proofTxid)}" data-wallet-required data-confirmations-ready="${confirmedEnough}" ${!c.account()||!confirmedEnough?'disabled':''}>${confirmedEnough?'Verify confirmation proof':`Wait for ${c.state().relay.required} confirmations`}</button>`:''}<button data-refresh-detail>Refresh Bitcoin status</button></div><p class="fine">Bitcoin API observations are advisory. Only a valid proof against the confirmed relay chain completes a withdrawal. A broadcast response is not settlement.</p><dl class="transaction-facts"><div><dt>Bitcoin txid</dt><dd class="mono wrap">${esc(t.txid)}</dd></div><div><dt>Miner fee</dt><dd>${btc(t.fee)} · ${t.fee_rate} sat/vB policy</dd></div><div><dt>Change retained in custody</dt><dd>${btc(t.change)}</dd></div><div><dt>Created</dt><dd>${when(b.created)}</dd></div></dl><div class="signers">${cards}</div><h3>Reserved inputs</h3>${table(['Input','Value','Public derivation','Signature progress'],inputRows)}<h3>Withdrawals in this batch</h3>${table(['Request','Amount received','Bitcoin destination','Network fee charged'],d.withdrawals.map((w:any)=>`<tr><td>#${w.id} · @${esc(w.owner)}</td><td>${btc(w.amount)}</td><td class="mono wrap">${esc(w.address)}</td><td>${finished?btc(w.paid_fee):'Within '+btc(w.max_fee)+' cap'}</td></tr>`).join(''))}<details id="batch-revisions"><summary>All transaction revisions</summary>${table(['Revision','Transaction','Miner fee','Signing'],revisions)}<p class="fine">A previously registered revision can still settle this batch. Broadcasting always uses the latest authorized revision.</p></details><details id="batch-raw"><summary>Inspect transaction bytes</summary><label>Fully signed Bitcoin transaction<textarea readonly rows="5">${esc(d.raw||(finished?'Confirmed on Bitcoin; signed bytes were not assembled on Psibase.':'Not fully signed yet'))}</textarea></label><label>Deterministic unsigned transaction<textarea readonly rows="5">${esc(d.unsigned)}</textarea></label></details>`;
   restoreDetails(el('batch-detail'),markup);lastRefresh=Date.now();
  }catch(error){el('batch-detail').textContent=(error as Error).message;}
 }
 async function broadcast(id:number){
  const d=await c.request(`/explorer/batch?id=${id}`);if(d.batch.status!==0)throw Error('This batch is already complete.');if(!d.raw||!d.transaction.ready)throw Error('Every input needs two signatures before broadcast.');
  try{const response=await c.bitcoin('/tx',{method:'POST',headers:{'Content-Type':'text/plain'},body:d.raw});if(String(response).trim().toLowerCase()!==d.transaction.txid)throw Error('Bitcoin source returned a different transaction ID.');}
  catch(error){if(!/already.*(known|mempool|chain)|already exists/i.test((error as Error).message))throw error;}
  c.notify(`Fully signed transaction submitted to the Bitcoin source: ${d.transaction.txid}`);await observe([d.transaction.txid]);await refresh(true);
 }
 async function collect(id:number){
  let d=await c.request(`/explorer/batch?id=${id}`);if(d.batch.status!==0)return;
  for(const p of d.providers){if(p.gathered)continue;const method=p.requested<p.total?'requestSigs':p.signed===p.total?'gather':null;if(!method)continue;
   await c.transact([action(method,{batch:id,rev:d.batch.current_revision,signer:p.signer,...(method==='requestSigs'?{max_requests:16}:{})})]);}
  c.notify('Signature requests and available responses submitted. Signing providers publish signatures independently.');await c.reload();await fetchDetail();
 }
 async function handleClick(e:MouseEvent){const node=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!node||operating)return;operating=true;node.disabled=true;
  try{if(node.dataset.broadcast)await broadcast(Number(node.dataset.broadcast));
   else if(node.dataset.collect)await collect(Number(node.dataset.collect));
   else if(node.dataset.cancelWithdrawal){await c.transact([action('cancel',{request:Number(node.dataset.cancelWithdrawal)})]);c.notify('Withdrawal cancellation submitted.');await c.reload();historyFetched=0;await refresh(true);}
   else if(node.dataset.completeTx){await c.complete(node.dataset.completeTx);await refresh(true);}
   else if(node.hasAttribute('data-refresh-detail'))await fetchDetail();
   else if(node.dataset.copy){await navigator.clipboard.writeText(node.dataset.copy);c.notify('Public deposit address copied.');}
   else if(node.dataset.inspectTx){await observe([node.dataset.inspectTx]);const status=observed(node.dataset.inspectTx);c.notify(status?.confirmed?`Bitcoin source reports this transaction confirmed in block ${status.block_height}.`:status?.seen?'Bitcoin source sees this transaction in its mempool.':status?.missing?'This Bitcoin source does not currently see the transaction.':'Bitcoin source unavailable.');}
  }catch(error){c.notify((error as Error).message,true);}finally{operating=false;if(node.isConnected)node.disabled=false;}
 }
 function route(){const match=location.hash.match(/^#explorer(?:\/(batches|utxos|deposits|withdrawals|addresses|batch)(?:\/(\d+))?)?$/);
  const isExplorer=!!match;el('bridge-view').hidden=isExplorer;el('explorer-view').hidden=!isExplorer;
  if(!isExplorer){detail=null;void fetchHistory();return;}
  const oldView=view;view=match![1]==='batch'?'batches':match![1]||'batches';detail=match![1]==='batch'?Number(match![2]):null;
  if(view!==oldView){cursor=null;stack=[];filter=view==='batches'?'0':'all';lastMarkup='';++generation;}
  el('explorer-list').hidden=detail!==null;el('batch-detail').hidden=detail===null;
  el('explorer-title').textContent=({batches:'Pending Bitcoin transactions',utxos:'Custody UTXOs',deposits:'Confirmed deposits',withdrawals:'Withdrawal requests',addresses:'Public deposit addresses'} as any)[view];
  el('explorer-filter-status').hidden=!['batches','utxos'].includes(view);el('explorer-filter-owner').hidden=!['deposits','withdrawals','addresses'].includes(view);el('explorer-owner-form').hidden=!['deposits','withdrawals','addresses'].includes(view);
  el<HTMLSelectElement>('explorer-status').innerHTML=view==='batches'?'<option value="0">Pending</option><option value="1">Complete</option><option value="all">All batches</option>':'<option value="all">All UTXOs</option><option value="0">Available</option><option value="1">Reserved</option><option value="2">Spent</option>';
  el<HTMLSelectElement>('explorer-status').value=filter;
  document.querySelectorAll<HTMLAnchorElement>('[data-explorer-tab]').forEach(a=>a.setAttribute('aria-current',String(a.dataset.explorerTab===view)));
  void refresh(true);
 }
 async function refresh(force=false){if(!c.state()||operating&&!force)return;if(!force&&Date.now()-lastRefresh<8000)return;if(el('explorer-view').hidden){await fetchHistory(force);return;}if(detail!==null)await fetchDetail();else await fetchList();}
 el('explorer-results').addEventListener('click',e=>{void handleClick(e);});el('batch-detail').addEventListener('click',e=>{void handleClick(e);});el('history-results').addEventListener('click',e=>{void handleClick(e);});
 el('explorer-next').onclick=()=>{if(next){stack.push(cursor);cursor=next;lastMarkup='';void fetchList();}};
 el('explorer-prev').onclick=()=>{if(stack.length){cursor=stack.pop()!;lastMarkup='';void fetchList();}};
 el('explorer-status').onchange=()=>{filter=el<HTMLSelectElement>('explorer-status').value;cursor=null;stack=[];lastMarkup='';++generation;void fetchList();};
 el('explorer-owner-form').onsubmit=e=>{e.preventDefault();owner=el<HTMLInputElement>('explorer-owner').value.trim().replace(/^@/,'');cursor=null;stack=[];lastMarkup='';++generation;void fetchList();};
 el('explorer-refresh').onclick=()=>{void refresh(true);};
 for(const name of ['deposits','withdrawals'])el(`history-${name}`).onclick=()=>{historyView=name;historyCursor=null;historyStack=[];++historyGeneration;historyFetched=0;el('history-deposits').setAttribute('aria-selected',String(name==='deposits'));el('history-withdrawals').setAttribute('aria-selected',String(name==='withdrawals'));void fetchHistory(true);};
 el('history-next').onclick=()=>{if(historyNext){historyStack.push(historyCursor);historyCursor=historyNext;void fetchHistory(true);}};
 el('history-prev').onclick=()=>{if(historyStack.length){historyCursor=historyStack.pop()!;void fetchHistory(true);}};
 window.addEventListener('hashchange',route);route();
 return {onState(){void refresh();if(historyOwner!==c.account()){++historyGeneration;historyFetched=0;void fetchHistory(true);}},refresh};
}
