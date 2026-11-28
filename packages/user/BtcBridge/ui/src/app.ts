import {Transaction} from '@scure/btc-signer';
import {custodyAddress,fetchSignetBlock,SIGNET_BATCH,scriptLength,quoteAlone,admitWithdrawal,feeMargin,mostReceivable} from './bitcoin';
import QRCode from 'qrcode';
import {createExplorer} from './explorer';
import {mountAccountMenu,refreshAccountMenu} from './account-menu';
import {getSupervisor,siblingUrl,isRedirectErrorObject,handlePluginUserPrompt} from 'psibase-common';
const supervisor=getSupervisor();
const callPlugin=(service:string,intf:string,method:string,params:unknown[]=[],plugin='plugin',redirect=true)=>{
 let timer:ReturnType<typeof setTimeout>;
 return Promise.race([supervisor.functionCall({service,plugin,intf,method,params},{enabled:false,returnPath:'/'}).catch(error=>{if(redirect&&isRedirectErrorObject(error)){rememberDraft();handlePluginUserPrompt(error,'/');return new Promise(()=>{});}throw error;}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Psibase wallet did not respond. Reload this page or open it in a browser that supports the Psibase wallet.')),20000);})]).finally(()=>clearTimeout(timer));
};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let deployment:{bitcoin_api?:string}={};
// Used only when the deployment's config.json names no `bitcoin_api` and the user has set none.
// A block's reporting window is closed once its height is at or below the bridge's closed frontier (snapshot `window`).
const windowClosed=(height:number)=>height>0&&height<=(state?.window?.frontier??0);
const DEFAULT_SOURCES:Record<string,string>={bitcoin:'https://blockstream.info/api',signet:'https://mempool.space/signet/api'};
// Signet headers travel with their coinbase proof: four requests per block. One sync call relays at most this many.
const SIGNET_SYNC_LIMIT=4*SIGNET_BATCH;
let state:any,account='',recipient='',recipientState:any,contacts:any[]=[],profile:any=null,busy=false,syncing=false,endpoint='',loadSequence=0;
let contactsLoaded=false,recipientProfile:any=null;
function rememberDraft(){
 const forms:Record<string,Record<string,string>>={};
 for(const id of ['withdraw-form','recover-form']){forms[id]={};for(const field of Array.from(el<HTMLFormElement>(id).elements)){if(field instanceof HTMLInputElement&&field.name&&field.type!=='file')forms[id][field.name]=field.value;}}
 sessionStorage.setItem('btcbridge-wallet-return',JSON.stringify({account,route:location.hash,tab:el('withdraw-tab').getAttribute('aria-selected')==='true'?'withdraw':'deposit',forms}));
}
function restoreDraft(){
 const raw=sessionStorage.getItem('btcbridge-wallet-return');if(!raw)return;
 sessionStorage.removeItem('btcbridge-wallet-return');
 try{const draft=JSON.parse(raw);if(draft.account&&draft.account!==account)return;for(const[id,fields]of Object.entries(draft.forms||{})){const form=el<HTMLFormElement>(id);for(const[name,value]of Object.entries(fields as Record<string,string>)){const input=form?.elements.namedItem(name);if(input instanceof HTMLInputElement)input.value=value;}}if(draft.tab==='withdraw')el('withdraw-tab').click();if(draft.route)location.hash=draft.route;const txid=(el<HTMLFormElement>('recover-form').elements.namedItem('txid') as HTMLInputElement).value.trim();if(/^[a-f0-9]{64}$/i.test(txid))void findDeposit(txid).then(d=>{depositCandidate=d;renderDepositReview();}).catch(()=>{});message('Returned from the wallet. Review your details before submitting.');}catch{}
}
function controls(){document.querySelectorAll<HTMLButtonElement|HTMLSelectElement|HTMLInputElement>('[data-account-required],#withdraw-form input,#withdraw-form button,#new-address,#fresh-address,#sync,#participate,[data-wallet-required]').forEach(b=>b.disabled=busy||!account||b.dataset.confirmationsReady==='false');el<HTMLButtonElement>('new-address').disabled=busy||!account||recipient!==account;}

const pending=new Map<string,number>();
const fmt=(n:number|bigint)=>`${BigInt(n)/100000000n}.${(BigInt(n)%100000000n).toString().padStart(8,'0')}`;
const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function atoms(s:string):number{s=s.trim();if(!/^(\d+\.?\d{0,8}|\.\d{1,8})$/.test(s))throw Error('Enter an amount in BTC, for example 0.0005, with at most eight decimals.');const[a='0',b='']=s.split('.');const n=BigInt(a)*100000000n+BigInt(b.padEnd(8,'0'));if(n<=0n||n>2100000000000000n)throw Error('BTC amount out of range.');return Number(n);}
async function request(url:string,options?:RequestInit):Promise<any>{const r=await fetch(url,options),body=await r.text();let v:any;try{v=JSON.parse(body);}catch{v=body;}if(!r.ok)throw Error(typeof v==='object'?v.error||`Request failed (${r.status})`:String(v));return v;}
function message(text:string,error=false){const m=el('message');m.hidden=false;m.classList.toggle('error',error);m.textContent=text;}
function action(sender:string,service:string,method:string,data:unknown){return{sender,service,method,data};}
async function transact(actions:any[]){
 if(!account)throw Error('Sign in from the account menu to continue.');
 const current=await callPlugin('host','api','getCurrentUser',[],'accounts',false);
 if(current!==account||state?.owner!==account){void wallet().catch(()=>{});throw Error('The signed-in account changed. Nothing was sent; the page now shows the current account.');}
 const record=await callPlugin('accounts','api','getAccount',[account],'query',false);
 if(record?.authService!=='auth-sig')throw Error('This account must use key-based Psibase authentication.');
 if(actions.some(a=>a.sender!==account))throw Error('Transaction sender must be the signed-in account.');
 return callPlugin('btcbridge','api','submit',[JSON.stringify(actions)]);
}
async function wallet(){
 const current=await callPlugin('host','api','getCurrentUser',[],'accounts',false)||'';
 if(current!==account){account=current;recipient=current;recipientState=null;profile=null;contacts=[];contactsLoaded=false;pending.clear();++loadSequence;depositCandidate=null;el('deposit-review').textContent='';
  // Nothing of the previous account stays on the page while the new one loads.
  if(state){state={...state,owner:account,wallet:null,addresses:[],requests:[]};try{render();}catch{}}
  el('contacts-status').textContent='Deposit for a contact: your contacts are read with your permission.';}
 document.querySelectorAll<HTMLButtonElement|HTMLSelectElement|HTMLInputElement>('[data-account-required],#withdraw-form input,#withdraw-form button,#new-address,#fresh-address,#sync,#participate,[data-wallet-required]').forEach(b=>b.disabled=!account);
 if(account){
  const row=await callPlugin('accounts','api','getAccount',[account],'query',false);
  if(row?.authService!=='auth-sig'){account='';recipient='';recipientState=null;renderContacts();await load();throw Error('This account is not secured with auth-sig signing keys. Switch account from the account menu.');}
  const response=await request(siblingUrl(null,'profiles','/graphql'),{method:'POST',headers:{'Content-Type':'application/graphql'},body:`{profile(account:${JSON.stringify(account)}){account displayName bio}}`});
  profile=response.data?.profile||null;
 }
 renderContacts();await load();if(account&&!contactsLoaded){try{if(await callPlugin('profiles','api','hasReadPermission',[],'plugin',false)){await loadContacts();}}catch{}}restoreDraft();
}
async function loadContacts(){const owner=account;const next=await callPlugin('profiles','contacts','get');if(owner!==account)return;contacts=next;contactsLoaded=true;controls();el('contacts-status').textContent=`${contacts.length} contacts from your Psibase address book`;renderContacts();}
function renderContacts(){
 const choices=[{account,nickname:profile?.displayName||'Your account'},...contacts.filter(c=>c.account!==account)];
 el('deposit-recipient').innerHTML=choices.map(c=>`<option value="${esc(c.account)}">${esc(c.nickname||c.account)} · @${esc(c.account)}</option>`).join('');
 el<HTMLSelectElement>('deposit-recipient').value=recipient;
}
async function loadRecipient(){const target=recipient;recipientProfile=null;el('recipient-avatar').hidden=true;el('address-ready').hidden=true;el('address-empty').hidden=true;el('recipient-identity').textContent=`Loading verified deposit address for @${target}…`;recipientState=target&&target!==account?await request(`/snapshot?owner=${encodeURIComponent(target)}`):null;if(target!==recipient)return;if(target&&target!==account){const response=await request(siblingUrl(null,'profiles','/graphql'),{method:'POST',headers:{'Content-Type':'application/graphql'},body:`{profile(account:${JSON.stringify(target)}){displayName bio}}`});if(target!==recipient)return;recipientProfile=response.data?.profile;}render();}

// The account menu's own buttons are not the page's to disable.
const pageButtons=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(b=>!b.closest('#account-menu,[data-radix-popper-content-wrapper]'));
async function run(label:string,fn:()=>Promise<void>){if(busy)return;busy=true;pageButtons().forEach(b=>b.disabled=true);try{await fn();message(label);await load();}catch(e){message((e as Error).message,true);}finally{busy=false;pageButtons().forEach(b=>b.disabled=false);controls();}}
// The withdraw form. The user enters one number: what the recipient receives. The page adds the
// network fee and the bridge fee and shows the total that leaves the balance. Every figure comes
// from the current policy and custody outputs in the snapshot, by the service's own rules.
function withdrawFields(){const f=el<HTMLFormElement>('withdraw-form').elements,get=(n:string)=>(f.namedItem(n) as HTMLInputElement);return{address:get('address'),amount:get('amount'),max_fee:get('max_fee')};}
function tryAtoms(s:string):number|null{try{return atoms(s);}catch{return null;}}
type WithdrawalReview={amount:number|null,allowance:number,own:number|null,script:number,balance:number,most:number,admission:ReturnType<typeof admitWithdrawal>|null,refusal:string};
/// What the form would send and whether the service would take it; `refusal` is empty if it would.
function reviewWithdrawal():WithdrawalReview{
 const p=state.policy,f=withdrawFields(),outputs=state.utxos||[],script=scriptLength(p.network,f.address.value),amount=tryAtoms(f.amount.value);
 // The advanced field, if the user filled it in; otherwise the fee alone plus the margin.
 const own=f.max_fee.value.trim()?tryAtoms(f.max_fee.value):null,balance=account&&state.wallet?state.wallet.balance+state.wallet.incoming:0;
 const most=mostReceivable(p,outputs,script,balance,own);
 if(amount===null)return{amount,allowance:own??0,own,script,balance,most,admission:null,refusal:''};
 const alone=quoteAlone(p,outputs,script,amount),allowance=own??(alone?alone.fee+feeMargin(p):0),admission=admitWithdrawal(p,outputs,script,amount,allowance);
 let refusal='';
 if(amount<p.min_withdrawal)refusal=`The smallest withdrawal is ${fmt(p.min_withdrawal)} BTC.`;
 else if(!admission.ok&&admission.reason==='amount')refusal=admission.most?`The bridge can pay at most ${fmt(admission.most)} BTC to this address now, with a network fee of ${fmt(admission.fee)} BTC: it pays the fee from its Bitcoin outputs and keeps ${fmt(p.dust)} BTC as change. Enter ${fmt(Math.min(admission.most,most||admission.most))} BTC or less, or wait for more deposits.`:'The bridge\'s confirmed Bitcoin outputs cannot pay a withdrawal now. Wait for more deposits.';
 else if(!admission.ok)refusal=`The network fee for this withdrawal is ${fmt(admission.least)} BTC; the maximum network fee is below it. Raise it to at least ${fmt(admission.least)} BTC, or leave it empty.`;
 else if(amount+allowance+p.service_fee>balance)refusal=`This withdrawal takes ${fmt(amount+allowance+p.service_fee)} BTC from your balance: ${fmt(amount)} to the recipient, up to ${fmt(allowance)} network fee and the ${fmt(p.service_fee)} bridge fee. You have ${fmt(balance)} BTC${most?`; the most the recipient can receive is ${fmt(most)} BTC`:''}.`;
 return{amount,allowance,own,script,balance,most,admission,refusal};
}
// What the Max button fills in: the most the recipient can receive now.
let withdrawMost=0;
function renderWithdrawQuote(){
 if(!state?.policy)return;const p=state.policy,r=reviewWithdrawal(),fee=r.admission?.ok?r.admission.fee:null;
 el('minimum-withdrawal').textContent=`${fmt(p.min_withdrawal)} BTC`;el('withdraw-margin').textContent=fmt(feeMargin(p));
 withdrawFields().max_fee.placeholder=r.amount!==null&&r.own===null&&r.allowance?fmt(r.allowance):'Fee alone + margin';
 el('withdraw-receives').textContent=r.amount===null?'The amount you enter':`${fmt(r.amount)} BTC`;
 el('withdraw-network-fee').textContent=fee===null?`At ${p.fee_rate} sat/vB`:`${fmt(fee)} BTC now, less if batched with others`;
 el('withdraw-total').textContent=r.amount===null||!r.allowance?'Amount + network fee + bridge fee':`${fmt(r.amount+r.allowance+p.service_fee)} BTC`;
 el('withdraw-returned').textContent=fee===null?'The unused part of the network fee':`${fmt(r.allowance-fee)} BTC or more`;
 withdrawMost=r.most;el<HTMLButtonElement>('withdraw-max').disabled=!account||!r.most;
 el('withdraw-most').textContent=account?`${fmt(r.most)} BTC`:'Sign in to see';
 el('withdraw-refusal').hidden=!r.refusal||!account;el('withdraw-refusal').textContent=r.refusal;
}
function derivedAddress(index:number):string{return custodyAddress(state.policy.network,state.policy.xpubs,0,index);}
async function load(){const owner=account,sequence=++loadSequence,next=await request(`/snapshot${owner?'?owner='+encodeURIComponent(owner):''}`);if(owner!==account||sequence!==loadSequence)return;if(!next.config)throw Error('BTC Bridge has not been initialized.');state={...next,owner};render();if(depositCandidate&&!checkingDeposit&&Date.now()-depositCheckAt>10000){depositCheckAt=Date.now();const txid=depositCandidate.txid;void findDeposit(txid).then(d=>{if(depositCandidate?.txid===txid){depositCandidate=d;renderDepositReview();}}).catch(()=>{});}}
function render(){controls();const{config:c,policy:p,relay:r}=state;
 if(!endpoint){endpoint=localStorage.getItem(`btcbridge-endpoint-${p.network}`)||(deployment.bitcoin_api||DEFAULT_SOURCES[p.network]||'');el<HTMLInputElement>('endpoint').value=endpoint;}
 el('network').textContent=p.network==='regtest'?'REGTEST · TEST BTC':p.network==='signet'?'Bitcoin signet — test coins, no value':'BITCOIN';el<HTMLAnchorElement>('exchange-link').href=`${location.protocol}//exchange.${location.host.split('.').slice(1).join('.')}/`;
 el('network-notice').hidden=p.network==='bitcoin';el('network-notice').textContent=p.network==='signet'?'Bitcoin signet: a public test network. These coins have no value. Send signet coins from your own wallet; never send real bitcoin to these addresses.':'Isolated test network. These BTC have no real-world value. Use your Psibase account and signing key. Funding and mining are managed outside this app.';
 el('relay-trust').hidden=p.network!=='signet';el('relay-trust').textContent='On signet the relay verifies each block\'s proof of work and the signet signers\' block signature. The signet signers are trusted, as they are by every signet node.';
 el('balance').innerHTML=account?`${fmt((state.wallet?.balance||0)+(state.wallet?.incoming||0))} <small>BTC</small>`:'Not signed in';el('balance-detail').textContent=`Native token #${c.token} · ${r.required} Bitcoin confirmations required`;
 el('reserve').textContent=`${fmt(c.reserve)} BTC`;
 const supply=Number(state.token.issued_supply.value??state.token.issued_supply)-Number(state.token.burned_supply.value??state.token.burned_supply);el('supply').textContent=`${fmt(supply)} BTC`;
 el('height').textContent=Number(r.height).toLocaleString();const timeBytes=state.tip_header.raw.slice(136,144).match(/../g)||[];const seconds=Number(state.now)-parseInt(timeBytes.reverse().join(''),16);
 el('relay-status').textContent=c.paused||r.paused?'Paused':seconds>21600?'Stale — sync required':'Synchronized';if(c.paused||r.paused)message(c.reason||r.reason,true);
 el('custody-policy').textContent=JSON.stringify({network:p.network,threshold:'2 of 3',extended_public_keys:p.xpubs,checkpoint:r.checkpoint,confirmation_depth:r.required},null,2);
 el('confirmation-note').textContent=`Credit after ${r.required} confirmations`;el('deposit-deadline').textContent=`Your deposit is credited once it is reported to the bridge. This normally happens automatically within minutes of the payment confirming. If it has not, report it yourself below (paste the transaction ID) within about ${Math.max(1,Math.round((p.report_blocks??1000)/144))} days of the payment (${p.report_blocks??1000} Bitcoin blocks). A deposit reported later is not credited.`;el('minimum-deposit').textContent=`Minimum ${fmt(p.min_deposit)} BTC`;el('service-fee').textContent=`${fmt(p.service_fee)} BTC`;renderWithdrawQuote();el('batch-window').textContent=`Up to ${p.batch_seconds/60} min, or ${p.batch_size} requests`;
 el('deposit-title').textContent=recipient&&recipient!==account?`Send Bitcoin to @${recipient}`:'Send Bitcoin to your account';el('deposit-description').textContent='This deposit address is secured by two of three independent custody keys.';el('deposit-address-label').textContent=recipient&&recipient!==account?`Bitcoin deposit address for @${recipient}`:'Your Bitcoin deposit address';
 const a=(recipientState||state).addresses.find((a:any)=>a.owner===recipient);el('recipient-identity').textContent=recipient?`${recipientProfile?.displayName?recipientProfile.displayName+' · ':''}BTC sent here is credited to @${recipient}. Check the account name before sending.`:'Sign in from the account menu to receive BTC.';el('new-address').textContent=account?'Create deposit address':'Sign in to deposit';el<HTMLButtonElement>('new-address').disabled=!account||recipient!==account;el('new-address').title=recipient!==account?'This contact needs to create their first deposit address in BTC Bridge.':'';el('fresh-address').hidden=recipient!==account;const avatar=el<HTMLImageElement>('recipient-avatar');avatar.hidden=!recipient||recipient===account;if(!avatar.hidden){avatar.src=siblingUrl(null,'profiles',`/avatar/${recipient}`);avatar.onerror=()=>avatar.hidden=true;}el('address-empty').hidden=!!a;el('address-ready').hidden=!a;
 if(a){const address=derivedAddress(a.index);if(address!==a.address)throw Error('Deposit address failed independent public derivation.');el<HTMLInputElement>('deposit-address').value=address;el('address-verification').textContent='Address verified from all three public keys';void QRCode.toCanvas(el<HTMLCanvasElement>('qr'),`bitcoin:${address}`,{width:124,margin:0,errorCorrectionLevel:'M'});}

 const fees=state.deposit_fee_terms||{fee_bps:0,publisher_bps:0};
 el('deposit-fee-note').textContent=`Deposit fee: ${fees.fee_bps/100}%. The first valid proof publisher receives ${fees.publisher_bps/100}% of that fee. Withdrawal fees are shown before you submit.`;
 el('deposit-fee-policy').textContent=JSON.stringify({effective:fees,announced:state.deposit_fee_policy},null,2);
 renderDepositReview();explorer.onState();
 el('updated').textContent=`Psibase block ${state.block_num} · Updated ${new Date().toLocaleTimeString()}`;
}
async function bitcoin(path:string,options?:RequestInit){if(!endpoint)throw Error('Set a Bitcoin API endpoint for this network.');return request(`${endpoint.replace(/\/$/,'')}${path}`,options);}
async function syncHeaders(){const remote=Number(await bitcoin('/blocks/tip/height'));let common=Math.min(remote,state.relay.height);for(let tries=0;;tries++){const theirs=String(await bitcoin(`/block-height/${common}`)),ours=await request(`/header?height=${common}`);if(theirs===ours?.id)break;if(common<=state.relay.checkpoint_height||tries>=128)throw Error('Bitcoin source disagrees beyond the supported fork window.');common--;}
 if(state.relay.network==='signet'){
  // The relay takes a signet header only with its coinbase transaction and Merkle branch (BIP 325 block signature).
  const last=Math.min(remote,common+SIGNET_SYNC_LIMIT);
  for(let h=common+1;h<=last;){const blocks=[];for(;h<=last&&blocks.length<SIGNET_BATCH;h++)blocks.push(await fetchSignetBlock(bitcoin,h));el('sync-status').textContent=`Relaying signet headers through ${h-1}${last<remote?` of ${remote}`:''}`;await transact([action(account,'btcrelay','signetHeaders',{blocks})]);}
  await load();return;
 }
 for(let h=common+1;h<=remote;){const headers:string[]=[];for(;h<=remote&&headers.length<32;h++){const hash=await bitcoin(`/block-height/${h}`);headers.push(String(await bitcoin(`/block/${hash}/header`)));}el('sync-status').textContent=`Relaying Bitcoin headers through ${h-1}`;await transact([action(account,'btcrelay','headers',{headers})]);}await load();}
async function transactionProof(txid:string,deposit=false){const info=await bitcoin(`/tx/${txid}`);if(!info.status.confirmed)return null;const proof=await bitcoin(`/tx/${txid}/merkle-proof`),block=info.status.block_hash||await bitcoin(`/block-height/${proof.block_height}`),count=state.relay.height-proof.block_height+1;if(deposit)pending.set(txid,count);if(count<state.relay.required)return null;return{info,args:{raw:String(await bitcoin(`/tx/${txid}/hex`)),block:String(block),siblings:proof.merkle,position:proof.pos}};}
type DepositCandidate={txid:string,raw:string,info:any,proof:any,block:string,height:number,reported:number,outputs:any[],fees:any};
let depositCandidate:DepositCandidate|null=null,checkingDeposit=false,publicCursor:string|null=null,depositCheckAt=0;
function bytes(hex:string){if(!/^(?:[a-f0-9]{2})+$/i.test(hex)||hex.length>2_000_000)throw Error('Bitcoin source returned an invalid or oversized transaction.');return Uint8Array.from(hex.match(/../g)!,b=>parseInt(b,16));}
const hex=(b:Uint8Array)=>Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
function feeAmounts(value:number,fees:any){const fee=Number(BigInt(value)*BigInt(fees.fee_bps)/10000n),bounty=Number(BigInt(fee)*BigInt(fees.publisher_bps)/10000n);return{fee,bounty,net:value-fee};}
async function findDeposit(txid:string):Promise<DepositCandidate>{
 if(!/^[a-f0-9]{64}$/i.test(txid))throw Error('Paste a 64-character Bitcoin transaction ID.');txid=txid.toLowerCase();
 const [info,raw,bridgeTx]=await Promise.all([bitcoin(`/tx/${txid}`),bitcoin(`/tx/${txid}/hex`),request(`/explorer/transaction?txid=${txid}`)]);
 if(bridgeTx)throw Error(`This is bridge withdrawal batch #${bridgeTx.batch}, not a new deposit.`);
 const transaction=Transaction.fromRaw(bytes(String(raw)),{allowUnknownInputs:true,allowUnknownOutputs:true});if(transaction.id!==txid)throw Error('Bitcoin transaction bytes do not match the requested transaction ID.');
 let proof:any=null,block='',height=0,reported=0;
 if(info.status?.confirmed){proof=await bitcoin(`/tx/${txid}/merkle-proof`);height=Number(proof.block_height);block=String(info.status.block_hash||await bitcoin(`/block-height/${height}`));const tip=Number(await bitcoin('/blocks/tip/height'));if(!Number.isSafeInteger(height)||height<0||!Number.isSafeInteger(tip)||tip<height)throw Error('Bitcoin source returned an invalid block height.');reported=tip-height+1;}
 const outputs:any[]=[];
 for(let vout=0;vout<transaction.outputsLength;vout++){
  const output=transaction.getOutput(vout);if(!output.script||output.amount===undefined)continue;const script=hex(output.script);if(script.length!==68||!script.startsWith('0020'))continue;
  const binding=await request(`/deposit-address?script=${script}`);if(!binding)continue;
  if(derivedAddress(binding.index)!==binding.address)throw Error('Registered deposit address failed independent public derivation.');
  const known=await request(`/outpoint?txid=${txid}&vout=${vout}`);const receipt=known?await request(`/explorer/deposit?outpoint=${txid}-${vout.toString(16).padStart(8,'0')}`):null;
  const value=Number(output.amount);if(!Number.isSafeInteger(value)||value<=0)throw Error('Invalid Bitcoin output amount.');outputs.push({vout,value,binding,known,receipt});
 }
 if(!outputs.length)throw Error('This transaction has no outputs to a registered BTC Bridge deposit address.');
 return{txid,raw:String(raw),info,proof,block,height,reported,outputs,fees:{...(state.deposit_fee_terms||{fee_bps:0,publisher_bps:0})}};
}
function renderDepositReview(){
 const d=depositCandidate;if(!d)return;const required=state.relay.required,unclaimed=d.outputs.filter(o=>!o.known&&o.value>=state.policy.min_deposit),ready=d.reported>=required;
 el('deposit-review').innerHTML=`<div class="deposit-receipt"><h4>${d.outputs.every(o=>o.known)?'Deposit already credited':d.outputs.some(o=>!o.known)&&windowClosed(d.height)?'Reported too late':ready?'Deposit ready for confirmed proof':'Waiting for Bitcoin confirmations'}</h4>${d.outputs.some(o=>!o.known)&&windowClosed(d.height)?'<p>This payment confirmed in a block whose reporting window has closed. It cannot be credited.</p>':''}<p class="mono wrap">${esc(d.txid)}</p><p>${d.reported}/${required} confirmations reported by the Bitcoin source. The contract independently verifies the confirmed canonical block and Merkle proof.</p>${d.outputs.map(o=>{const f=feeAmounts(o.value,d.fees),r=o.receipt;return `<div class="deposit-output"><strong>Output ${o.vout} → @${esc(o.binding.owner)}</strong><p>${fmt(o.value)} BTC deposited · ${fmt(r?.credited??f.net)} BTC recipient credit</p><small>${o.known?'Already accepted on Psibase':o.value<state.policy.min_deposit?'Below the minimum deposit':`Deposit fee ${fmt(f.fee)} BTC · first publisher reward ${fmt(f.bounty)} BTC`}${r?.publisher?` · published by @${esc(r.publisher)}`:''}</small></div>`;}).join('')}${unclaimed.length?`<button id="submit-deposit-proof" class="primary" data-wallet-required data-confirmations-ready="${ready}" ${busy||!ready||!account?'disabled':''}>${!account?'Sign in to publish proof':ready?'Verify and submit confirmed proof':`Wait for ${required} confirmations`}</button>`:''}<p class="fine">The registered recipient always receives the deposit credit. ${account?`The first valid proof earns its reward for @${esc(account)}.`:'Any signed-in Psibase account can publish the proof.'} Another publisher may claim the reward first.</p></div>`;
 const button=document.getElementById('submit-deposit-proof');if(button)button.onclick=()=>{void run('Deposit proof accepted. Recipient credit and publisher reward are recorded on Psibase.',submitDeposit);};
}
async function submitDeposit(){
 if(!depositCandidate)throw Error('Find a deposit first.');const txid=depositCandidate.txid,quoted=JSON.stringify(depositCandidate.fees);await load();const d=await findDeposit(txid);depositCandidate=d;renderDepositReview();if(quoted!==JSON.stringify(d.fees))throw Error('The deposit fee policy changed. Review the updated credit and reward before submitting again.');
 if(d.reported<state.relay.required)throw Error(`Wait for ${state.relay.required} Bitcoin confirmations.`);
 await syncHeaders();const canonical=await request(`/header?height=${d.height}`);if(canonical?.id!==d.block||state.relay.height-d.height+1<state.relay.required)throw Error('The deposit block is not confirmed in the canonical relay chain. No Merkle proof was submitted.');
 const eligible=d.outputs.filter(o=>!o.known&&o.value>=state.policy.min_deposit);if(!eligible.length)throw Error('All eligible outputs have already been credited.');
 for(const output of eligible){try{await transact([action(account,'btcbridge','deposit',{raw:d.raw,block:d.block,siblings:d.proof.merkle,position:d.proof.pos,vout:output.vout})]);}
  catch(error){if(!/already processed/i.test((error as Error).message))throw error;}}
 for(let n=0;n<20;n++){if(await request(`/outpoint?txid=${txid}&vout=${eligible[0].vout}`))break;await new Promise(resolve=>setTimeout(resolve,500));}
 depositCandidate=await findDeposit(txid);renderDepositReview();if(depositCandidate.outputs.some(o=>!o.known&&eligible.some(e=>e.vout===o.vout)))throw Error('Proof submitted; Psibase confirmation is still pending. Refresh the deposit to check its receipt.');await explorer.refresh(true);
}
async function proveDeposit(txid:string){
 const d=await findDeposit(txid);if(d.reported<state.relay.required)return;const canonical=await request(`/header?height=${d.height}`);if(canonical?.id!==d.block||state.relay.height-d.height+1<state.relay.required)return;
 for(const output of d.outputs){if(output.known||output.value<state.policy.min_deposit)continue;try{await transact([action(account,'btcbridge','deposit',{raw:d.raw,block:d.block,siblings:d.proof.merkle,position:d.proof.pos,vout:output.vout})]);}catch(error){if(!/already processed|not a new deposit|Bridge-originated/i.test((error as Error).message))throw error;}}
}
async function completeTransaction(txid:string){await syncHeaders();const p=await transactionProof(txid);if(!p)throw Error(`Wait for ${state.relay.required} confirmed Bitcoin blocks.`);const canonical=await request(`/header?height=${p.info.status.block_height}`);if(canonical?.id!==p.args.block)throw Error('Transaction block is not canonical in the relay.');await transact([action(account,'btcbridge','complete',p.args)]);message('Confirmed withdrawal proof submitted.');await load();}

let watching=false;
async function watchDeposits(){
 if(watching||syncing||busy||!state||!account||!endpoint)return;watching=true;
 try{const addresses=(recipientState||state).addresses.slice(0,10);let detected=false;
  for(const address of addresses){const outputs=await bitcoin(`/address/${address.address}/utxo`);for(const output of outputs){if(await request(`/outpoint?txid=${output.txid}&vout=${output.vout}`))continue;detected=true;const tip=Number(await bitcoin('/blocks/tip/height')),confirmations=output.status?.confirmed?Math.max(0,tip-output.status.block_height+1):0;el('deposit-progress').textContent=`Deposit detected · Bitcoin source reports ${confirmations}/${state.relay.required} confirmations. Sync Bitcoin to verify and credit it.`;}}
  if(!detected)el('deposit-progress').textContent='Waiting for a Bitcoin deposit. Sync Bitcoin or enable browser relaying to verify transfers.';
 }catch{el('deposit-progress').textContent='Bitcoin source unavailable. Check your relay settings or use manual transaction recovery.';}finally{watching=false;}
}
async function sync(){if(syncing||busy||!state||!account)return;syncing=true;try{await syncHeaders();const publicPage=await request(`/explorer/addresses?limit=10${publicCursor?'&cursor='+publicCursor:''}`);publicCursor=publicPage.next;const scan=Array.from(new Map<string,any>([...state.addresses.slice(0,10),...publicPage.rows].map((a:any)=>[a.address,a])).values());for(const a of scan){const outputs=await bitcoin(`/address/${a.address}/utxo`);for(const txid of new Set<string>(outputs.map((u:any)=>u.txid))){try{await proveDeposit(txid);}catch(error){if(!/bridge withdrawal batch|already processed/i.test((error as Error).message))throw error;}}}
 const minedBatches=new Set<number>();
 for(const b of state.batches.filter((b:any)=>b.status===0)){
  let alreadyMined=false;for(const r of state.revisions.filter((r:any)=>r.batch===b.id)){try{if((await bitcoin(`/tx/${JSON.parse(r.plan).txid}`)).status?.confirmed){alreadyMined=true;minedBatches.add(b.id);break;}}catch(error){if(!/not found|no such mempool|no such transaction|404/i.test((error as Error).message))throw error;}}
  if(alreadyMined)continue;
  const rev=state.revisions.find((r:any)=>r.batch===b.id&&r.revision===b.current_revision);if(!rev||rev.raw)continue;const plan=JSON.parse(rev.plan);
  for(let signer=0;signer<3;signer++){
   if(state.signatures.some((s:any)=>s.batch===b.id&&s.revision===b.current_revision&&s.signer===signer))continue;
   const links=state.signing_links.filter((l:any)=>l.batch===b.id&&l.revision===b.current_revision&&l.signer===signer);
   if(links.length<plan.inputs.length)await transact([action(account,'btcbridge','requestSigs',{batch:b.id,rev:b.current_revision,signer,max_requests:16})]);
   else if(links.every((l:any)=>state.hash_requests.some((r:any)=>r.id===l.request&&r.signature)))await transact([action(account,'btcbridge','gather',{batch:b.id,rev:b.current_revision,signer})]);
  }
 }
 for(const revision of state.revisions){const b=state.batches.find((b:any)=>b.id===revision.batch);if(b?.status!==0)continue;const plan=JSON.parse(revision.plan);try{if(revision.revision===b.current_revision&&revision.raw&&!minedBatches.has(b.id))await bitcoin('/tx',{method:'POST',body:revision.raw,headers:{'Content-Type':'text/plain'}});}catch(e){if(!/already|mempool|conflict|missing.*input|spent/i.test((e as Error).message))throw e;}let proof;try{proof=await transactionProof(plan.txid);}catch(e){if(/not found|no such mempool|no such transaction|404/i.test((e as Error).message))continue;throw e;}if(proof)await transact([action(account,'btcbridge','complete',proof.args)]);}
 await load();const queued=state.requests.filter((r:any)=>r.status===0).sort((a:any,b:any)=>a.id-b.id);const free=(state.utxos||[]).filter((u:any)=>u.status===0).reduce((n:number,u:any)=>n+u.value,0),retry=state.requests.some((r:any)=>r.status===5&&r.amount+state.policy.dust<free);/* a request waiting for the reserve rejoins the queue inside makeBatch */if(retry||queued.length&&(queued.length>=state.policy.batch_size||state.now>=queued[0].created+state.policy.batch_seconds)){try{await transact([action(account,'btcbridge','makeBatch',{})]);}catch(e){if(!/Insufficient confirmed UTXOs|fee cap|Open batch limit|No pending withdrawals|not due/i.test((e as Error).message))throw e;}}
 el('sync-status').textContent=`Headers and proofs checked at ${new Date().toLocaleTimeString()}`;const counts=[...pending.values()].filter(n=>n<state.relay.required);el('deposit-progress').textContent=counts.length?`Deposit detected · ${Math.max(...counts)}/${state.relay.required} confirmations`:'Deposits checked. Confirmed funds are available above.';
 }catch(e){el('sync-status').textContent=(e as Error).message;}finally{syncing=false;}}
async function refreshUntil(predicate:(snapshot:any)=>boolean){for(let n=0;n<20;n++){await load();if(predicate(state))return;await new Promise(resolve=>setTimeout(resolve,500));}throw Error('Transaction submitted. Chain confirmation is still pending; refresh to check its status.');}
function newAddress(){return run('Deposit address created and independently verified.',async()=>{const owner=account,last=Math.max(-1,...state.addresses.map((a:any)=>a.index));if(recipient!==account)throw Error('Only the recipient can create a new deposit address.');await transact([action(account,'btcbridge','newAddress',{})]);await refreshUntil(s=>s.owner===owner&&s.addresses.some((a:any)=>a.owner===owner&&a.index>last));});}
el('deposit-recipient').onchange=()=>{recipient=el<HTMLSelectElement>('deposit-recipient').value;void loadRecipient().catch(e=>message(e.message,true));};
el('load-contacts').onclick=()=>{void loadContacts().catch(e=>message(e.message,true));};
el<HTMLAnchorElement>('wallet-link').href=siblingUrl(null,'homepage','/tokens');el<HTMLAnchorElement>('balance-wallet-link').href=siblingUrl(null,'homepage','/tokens');
el<HTMLAnchorElement>('manage-contacts').href=siblingUrl(null,'homepage','/contacts');
for(const tab of ['deposit','withdraw'])el(`${tab}-tab`).onclick=()=>{el('deposit-recovery').hidden=tab!=='deposit';for(const name of ['deposit','withdraw']){el(`${name}-panel`).hidden=name!==tab;el(`${name}-tab`).setAttribute('aria-selected',String(name===tab));}};
el('new-address').onclick=newAddress;el('fresh-address').onclick=newAddress;el('copy-address').onclick=()=>{void navigator.clipboard.writeText(el<HTMLInputElement>('deposit-address').value).then(()=>message('Deposit address copied.'));};el('refresh').onclick=()=>{void load().then(()=>explorer.refresh(true)).catch(e=>message(e.message,true));};el('sync').onclick=()=>{void sync();};
el('save-endpoint').onclick=()=>{try{const url=new URL(el<HTMLInputElement>('endpoint').value);if(url.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(url.hostname)&&location.hostname.endsWith('.localhost')&&state.policy.network==='regtest'))throw Error('Use HTTPS for remote Bitcoin sources.');endpoint=url.href.replace(/\/$/,'');localStorage.setItem(`btcbridge-endpoint-${state.policy.network}`,endpoint);message('Bitcoin source updated. All proofs remain verified by the contract.');}catch(e){message((e as Error).message,true);}};
el('withdraw-form').onsubmit=e=>{e.preventDefault();const data=new FormData(e.currentTarget as HTMLFormElement);void run('Withdrawal queued. Funds are locked until payment or cancellation.',async()=>{atoms(String(data.get('amount')));const r=reviewWithdrawal();if(r.own===null&&withdrawFields().max_fee.value.trim())throw Error('Enter the maximum network fee in BTC, or leave it empty.');if(r.refusal)throw Error(r.refusal);const amount=r.amount!,max_fee=r.allowance,locked=amount+max_fee+state.policy.service_fee,actions:any[]=[];const claim=Math.max(0,Math.min(state.wallet.incoming,locked-state.wallet.balance));if(claim)actions.push(action(account,'tokens','debit',{token_id:state.config.token,creditor:'btcbridge',amount:{value:claim},memo:'Receive bridge BTC'}));actions.push(action(account,'tokens','credit',{token_id:state.config.token,debitor:'btcbridge',amount:{value:locked},memo:'Authorize Bitcoin withdrawal'}));actions.push(action(account,'btcbridge','withdraw',{address:String(data.get('address')).trim(),amount,max_fee}));await transact(actions);});};
el('withdraw-form').addEventListener('input',renderWithdrawQuote);
el('withdraw-max').onclick=()=>{renderWithdrawQuote();if(withdrawMost>0){withdrawFields().amount.value=fmt(withdrawMost);renderWithdrawQuote();}};
el('recover-form').onsubmit=e=>{e.preventDefault();if(checkingDeposit)return;checkingDeposit=true;const data=new FormData(e.currentTarget as HTMLFormElement);el('deposit-review').textContent='Fetching Bitcoin transaction bytes, public address bindings, and confirmation data…';void findDeposit(String(data.get('txid')).trim()).then(d=>{depositCandidate=d;renderDepositReview();}).catch(error=>{depositCandidate=null;el('deposit-review').textContent=(error as Error).message;}).finally(()=>checkingDeposit=false);};
const explorer=createExplorer({state:()=>state,account:()=>account,request,bitcoin,transact,syncHeaders,complete:completeTransaction,reload:load,notify:message,fmt,esc});
mountAccountMenu(el('account-menu'));
// Signing in, switching and logging out happen in the sign-in app and return here. When this page is
// shown again, whether reloaded, restored from the back/forward cache or re-focused, ask who is signed in.
const accountMayHaveChanged=()=>{void refreshAccountMenu();if(state&&!busy)void wallet().catch(e=>message(e.message,true));};
window.addEventListener('pageshow',e=>{if(e.persisted)accountMayHaveChanged();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)accountMayHaveChanged();});
controls();void request('/config.json').then(config=>{deployment=config;}).catch(()=>{}).then(async()=>{await load();await wallet();}).catch(e=>message(e.message,true));
setInterval(()=>{if(!busy)void load().catch(e=>el('updated').textContent=e.message);},5000);setInterval(()=>{if(el<HTMLInputElement>('participate').checked)void sync();else void watchDeposits();},12000);
