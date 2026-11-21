#!/usr/bin/env node
// Compare the previous actual UI helper source with the current indexed
// portfolio projection. The baseline snapshot is a review artifact, not code
// loaded by the exchange. No timing threshold is asserted by unit tests.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {projectPortfolio} from '../packages/user/Exchange/ui/src/portfolio.js';
import {beforePortfolio} from './fixtures/ui-portfolio-before.js';
const source=await readFile(new URL('./fixtures/ui-portfolio-before.js',import.meta.url),'utf8');
const fixture=(tokens,positions)=>({account:'alice',data:{owner:'alice',
 tokens:Array.from({length:tokens},(_,i)=>({id:i+1})),balances:Array.from({length:tokens},(_,i)=>({token:i+1,incoming:'1',outgoing:'2'})),
 markets:Array.from({length:100},(_,i)=>({id:i+1,base:1,quote:2,margin_enabled:true,escrow_base:{funded:true},escrow_quote:{funded:true}})),
 positions:Array.from({length:positions},(_,i)=>({owner:'alice',market:i%100+1,bid:false,generation:i+1,refund:'3',proceeds:'4'})),
 levels:Array.from({length:1000},(_,i)=>({market:i%100+1,bid:false,price:i+1,outgoing:100,active:true})),
 loan_positions:Array.from({length:positions},(_,i)=>({owner:'alice',market:i%100+1,generation:i+1,units:'1'})),
 loans:Array.from({length:positions},(_,i)=>({market:i%100+1,generation:i+1,long:true,active:false,claimable_surplus:'5',collateral_unit:'2'})),stop_positions:[]
}});
const summarize=values=>{const s=[...values].sort((a,b)=>a-b);return{median_ms:s[Math.floor(s.length/2)],p95_ms:s[Math.ceil(s.length*.95)-1],min_ms:s[0],max_ms:s.at(-1),samples_ms:values};};
const results=[];
for(const [tokens,positions] of [[2,100],[100,100],[1000,100],[2,500],[100,500],[1000,1000]]){
 const state=fixture(tokens,positions),before=beforePortfolio(state);
 const after=()=>{const p=projectPortfolio(state.data,state.account);return state.data.tokens.map(t=>[p.available(t.id),p.committed(t.id)]);};
 const expected=before();
 const check=result=>{if(result.length!==expected.length||result.some((row,i)=>row.some((v,j)=>v!==expected[i][j])))throw new Error('Portfolio projection changed amounts');};
 check(after());
 const samples={before:{cpu:[],wall:[]},after:{cpu:[],wall:[]}};
 for(let run=0;run<5;run++)for(const name of run%2?['after','before']:['before','after']){
  const cpu=process.cpuUsage(),start=performance.now();const result=(name==='before'?before:after)();
  const elapsed=performance.now()-start,used=process.cpuUsage(cpu);samples[name].cpu.push((used.user+used.system)/1000);samples[name].wall.push(elapsed);check(result);
 }
 const result={tokens,maker_positions:positions,loan_positions:positions,markets:100,public_levels:1000,n:5,before:{cpu:summarize(samples.before.cpu),wall:summarize(samples.before.wall)},after:{cpu:summarize(samples.after.cpu),wall:summarize(samples.after.wall)}};
 result.cpu_speedup=result.before.cpu.median_ms/result.after.cpu.median_ms;results.push(result);
 console.log(JSON.stringify({tokens,positions,before_cpu_ms:result.before.cpu.median_ms,after_cpu_ms:result.after.cpu.median_ms,speedup:result.cpu_speedup}));
}
await writeFile(new URL('./ui-portfolio-benchmark.json',import.meta.url),JSON.stringify({baseline_fixture_sha256:createHash('sha256').update(source).digest('hex'),baseline_full_app_sha256:'73574f50ed9960038511b5b2408f23244f71dc3bc95a241421ceb7747432a996',scope:'Actual previous accrued/committed helpers vs current per-snapshot projection plus all-token lookups. Same exact amounts for every token asserted; excludes DOM/format/network. Synthetic bounded snapshot, shared BTC/USD markets; interleaved process CPU and wall times.',results},null,2));
