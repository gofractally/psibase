import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
await mkdir('dist',{recursive:true});
// Resolve this npm island independently of the parent repository's Yarn PnP workspace.
const npmResolver={name:'local-npm',setup(b){b.onResolve({filter:/^[^./]|^@/},args=>{
 if(args.kind==='entry-point')return;
 if(args.path==='psibase-common')return{path:'/common/common-lib.js',external:true};
 const req=createRequire(resolve(args.resolveDir||process.cwd(),'package.json'));
 return{path:req.resolve(args.path==='qrcode'?'qrcode/lib/browser.js':args.path)};
});}};
await build({entryPoints:['src/app.ts'],bundle:true,format:'esm',target:'es2022',outfile:'dist/app.js',minify:true,external:['/common/common-lib.js'],plugins:[npmResolver]});
for(const name of ['index.html','style.css'])await copyFile(name,`dist/${name}`);
console.log('BTC Bridge UI built');
