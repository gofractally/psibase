(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const o of n)if(o.type==="childList")for(const s of o.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&i(s)}).observe(document,{childList:!0,subtree:!0});function r(n){const o={};return n.integrity&&(o.integrity=n.integrity),n.referrerPolicy&&(o.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?o.credentials="include":n.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function i(n){if(n.ep)return;n.ep=!0;const o=r(n);fetch(n.href,o)}})();const N="modulepreload",D=function(e){return"/loader/"+e},x={},F=function(t,r,i){let n=Promise.resolve();if(r&&r.length>0){const o=document.getElementsByTagName("link");n=Promise.all(r.map(s=>{if(s=D(s),s in x)return;x[s]=!0;const a=s.endsWith(".css"),f=a?'[rel="stylesheet"]':"";if(!!i)for(let g=o.length-1;g>=0;g--){const l=o[g];if(l.href===s&&(!a||l.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${s}"]${f}`))return;const c=document.createElement("link");if(c.rel=a?"stylesheet":N,a||(c.as="script",c.crossOrigin=""),c.href=s,document.head.appendChild(c),a)return new Promise((g,l)=>{c.addEventListener("load",g),c.addEventListener("error",()=>l(new Error(`Unable to preload CSS for ${s}`)))})}))}return n.then(()=>t()).catch(o=>{const s=new Event("vite:preloadError",{cancelable:!0});if(s.payload=o,window.dispatchEvent(s),!s.defaultPrevented)throw o})},O=`import { connectToParent } from "penpal";

function derp(num) {
  return num * 2;
}

export async function funccall(params) {
  console.log(params, "are received params in importables...");
  return "yesbuddeh funcCall";
}

export function getLoggedInUser() {
  console.log("I WAS ASKED FOR ALICE");
  return "alice";
}

export async function prnt(string) {
  console.log(window, window.postMessage, "was the window post message");
  console.log(\`from imported code: \${derp(2)}\`, string);

  console.log(connectToParent, "is the connect to parent");

  const xx = await connectToParent().promise;

  console.log(xx, "received in rust..");

  const toCall = {
    service: "idunno",
    method: "stilldontknow",
    params: "yesbuddeh",
  };
  const res = await xx.functionCall(toCall);

  console.log(res, "came back from the imported call...");
}

export async function addToTx(params) {
  console.log("addedToTx", params);

  const connection = await connectToParent().promise;
  await connection.addToTx(params);
}
`;var y;(function(e){e.Call="call",e.Reply="reply",e.Syn="syn",e.SynAck="synAck",e.Ack="ack"})(y||(y={}));var v;(function(e){e.Fulfilled="fulfilled",e.Rejected="rejected"})(v||(v={}));var P;(function(e){e.ConnectionDestroyed="ConnectionDestroyed",e.ConnectionTimeout="ConnectionTimeout",e.NoIframeSrc="NoIframeSrc"})(P||(P={}));var T;(function(e){e.DataCloneError="DataCloneError"})(T||(T={}));var E;(function(e){e.Message="message"})(E||(E={}));const _=(e,t)=>{const r=[];let i=!1;return{destroy(n){i||(i=!0,t(`${e}: Destroying connection`),r.forEach(o=>{o(n)}))},onDestroy(n){i?n():r.push(n)}}},j=e=>(...t)=>{e&&console.log("[Penpal]",...t)},A=({name:e,message:t,stack:r})=>({name:e,message:t,stack:r}),K=e=>{const t=new Error;return Object.keys(e).forEach(r=>t[r]=e[r]),t},V=(e,t,r)=>{const{localName:i,local:n,remote:o,originForSending:s,originForReceiving:a}=e;let f=!1;const m=c=>{if(c.source!==o||c.data.penpal!==y.Call)return;if(a!=="*"&&c.origin!==a){r(`${i} received message from origin ${c.origin} which did not match expected origin ${a}`);return}const g=c.data,{methodName:l,args:d,id:h}=g;r(`${i}: Received ${l}() call`);const C=u=>p=>{if(r(`${i}: Sending ${l}() reply`),f){r(`${i}: Unable to send ${l}() reply due to destroyed connection`);return}const w={penpal:y.Reply,id:h,resolution:u,returnValue:p};u===v.Rejected&&p instanceof Error&&(w.returnValue=A(p),w.returnValueIsError=!0);try{o.postMessage(w,s)}catch(S){if(S.name===T.DataCloneError){const R={penpal:y.Reply,id:h,resolution:v.Rejected,returnValue:A(S),returnValueIsError:!0};o.postMessage(R,s)}throw S}};new Promise(u=>u(t[l].apply(t,d))).then(C(v.Fulfilled),C(v.Rejected))};return n.addEventListener(E.Message,m),()=>{f=!0,n.removeEventListener(E.Message,m)}};let H=0;const B=()=>++H,b=".",k=e=>e?e.split(b):[],U=e=>e.join(b),z=(e,t)=>{const r=k(t||"");return r.push(e),U(r)},W=(e,t,r)=>{const i=k(t);return i.reduce((n,o,s)=>(typeof n[o]>"u"&&(n[o]={}),s===i.length-1&&(n[o]=r),n[o]),e),e},I=(e,t)=>{const r={};return Object.keys(e).forEach(i=>{const n=e[i],o=z(i,t);typeof n=="object"&&Object.assign(r,I(n,o)),typeof n=="function"&&(r[o]=n)}),r},Y=e=>{const t={};for(const r in e)W(t,r,e[r]);return t},q=(e,t,r,i,n)=>{const{localName:o,local:s,remote:a,originForSending:f,originForReceiving:m}=t;let c=!1;n(`${o}: Connecting call sender`);const g=d=>(...h)=>{n(`${o}: Sending ${d}() call`);let C;try{a.closed&&(C=!0)}catch{C=!0}if(C&&i(),c){const u=new Error(`Unable to send ${d}() call due to destroyed connection`);throw u.code=P.ConnectionDestroyed,u}return new Promise((u,p)=>{const w=B(),S=M=>{if(M.source!==a||M.data.penpal!==y.Reply||M.data.id!==w)return;if(m!=="*"&&M.origin!==m){n(`${o} received message from origin ${M.origin} which did not match expected origin ${m}`);return}const $=M.data;n(`${o}: Received ${d}() reply`),s.removeEventListener(E.Message,S);let L=$.returnValue;$.returnValueIsError&&(L=K(L)),($.resolution===v.Fulfilled?u:p)(L)};s.addEventListener(E.Message,S);const R={penpal:y.Call,id:w,methodName:d,args:h};a.postMessage(R,f)})},l=r.reduce((d,h)=>(d[h]=g(h),d),{});return Object.assign(e,Y(l)),()=>{c=!0}},Q=(e,t)=>{let r;return e!==void 0&&(r=window.setTimeout(()=>{const i=new Error(`Connection timed out after ${e}ms`);i.code=P.ConnectionTimeout,t(i)},e)),()=>{clearTimeout(r)}},G=(e,t,r,i)=>{const{destroy:n,onDestroy:o}=r;return s=>{if(!(e instanceof RegExp?e.test(s.origin):e==="*"||e===s.origin)){i(`Child: Handshake - Received SYN-ACK from origin ${s.origin} which did not match expected origin ${e}`);return}i("Child: Handshake - Received SYN-ACK, responding with ACK");const f=s.origin==="null"?"*":s.origin,m={penpal:y.Ack,methodNames:Object.keys(t)};window.parent.postMessage(m,f);const c={localName:"Child",local:window,remote:window.parent,originForSending:f,originForReceiving:s.origin},g=V(c,t,i);o(g);const l={},d=q(l,c,s.data.methodNames,n,i);return o(d),l}},J=()=>{try{clearTimeout()}catch{return!1}return!0},X=(e={})=>{const{parentOrigin:t="*",methods:r={},timeout:i,debug:n=!1}=e,o=j(n),s=_("Child",o),{destroy:a,onDestroy:f}=s,m=I(r),c=G(t,m,s,o),g=()=>{o("Child: Handshake - Sending SYN");const d={penpal:y.Syn},h=t instanceof RegExp?"*":t;window.parent.postMessage(d,h)};return{promise:new Promise((d,h)=>{const C=Q(i,a),u=p=>{if(J()&&!(p.source!==parent||!p.data)&&p.data.penpal===y.SynAck){const w=c(p);w&&(window.removeEventListener(E.Message,u),C(),d(w))}};window.addEventListener(E.Message,u),g(),f(p=>{window.removeEventListener(E.Message,u),p&&h(p)})}),destroy(){a()}}};document.querySelector("#app").innerHTML=`
  <div>
    <h1>App 2 / Loader</h1>
    <p>This is a generated SPA designed to act as the loader, its sole purpose is to be rendered in an iframe and run a WASM Component, then execute functions in the WASM component and send the results back to its parent iframe.</p>
  </div>
`;const Z=e=>typeof e=="object"&&e!==null&&"service"in e&&"method"in e&&"params"in e,ee=async e=>{if(!Z(e))throw new Error("Invalid function call param.");console.log("loading js... new hcange!");const{load:t}=await F(()=>import("./index-7vYoMxA8.js"),__vite__mapDeps([])),r="/loader/functions.wasm";console.log("fetching wasm...");const i=await fetch(r).then(m=>m.arrayBuffer());let n=[{[`component:${e.service}/imports`]:O}];console.log("loading wasm..."),console.time("Load");const{mod:o,imports:s,exports:a,files:f}=await t(i,n);return console.timeEnd("Load"),console.log(o,"is the module I have",{imports:s,exports:a,files:f}),o[e.method](...e.params)},ne=X({methods:{functionCall:ee}});ne.promise.then(e=>{console.log("Loader got parent",e),e.add(3,1).then(t=>console.log(t))});export{F as _};
function __vite__mapDeps(indexes) {
  if (!__vite__mapDeps.viteFileDeps) {
    __vite__mapDeps.viteFileDeps = []
  }
  return indexes.map((i) => __vite__mapDeps.viteFileDeps[i])
}