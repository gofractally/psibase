import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile,optimize} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';

const here=dirname(fileURLToPath(import.meta.url));
// The components every app shares; the account menu in the header comes from there.
const shared=resolve(here,'../../../shared-ui');
const local=createRequire(join(here,'package.json'));
await mkdir('dist',{recursive:true});

// A package's ES module entry where it has one, so unused exports (icons) are dropped.
function entry(req,spec){
 const main=req.resolve(spec);
 const parts=spec.split('/'),name=spec.startsWith('@')?parts.slice(0,2).join('/'):parts[0],sub='./'+spec.slice(name.length+1);
 let dir=dirname(main);
 while(!(existsSync(join(dir,'package.json'))&&JSON.parse(readFileSync(join(dir,'package.json'),'utf8')).name===name)){const up=dirname(dir);if(up===dir)return main;dir=up;}
 const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
 const pick=e=>typeof e==='string'?e:e&&typeof e==='object'&&!Array.isArray(e)?pick(e.import)??pick(e.module)??pick(e.default):undefined;
 const target=pkg.exports?pick(sub==='./'?(pkg.exports['.']??(Object.keys(pkg.exports).some(k=>k.startsWith('.'))?undefined:pkg.exports)):pkg.exports[sub]):sub==='./'?pkg.module:undefined;
 const path=target&&join(dir,target);
 return path&&existsSync(path)?path:main;
}
// Resolve this npm island independently of the parent repository's Yarn PnP workspace. Files of
// shared-ui have no packages of their own here: their imports resolve from this directory.
const npmResolver={name:'local-npm',setup(b){
 b.onResolve({filter:/^@shared\//},args=>b.resolve('./'+args.path.slice(8),{resolveDir:shared,kind:args.kind}));
 b.onResolve({filter:/^[^./]|^@/},args=>{
  if(args.kind==='entry-point')return;
  if(args.path==='psibase-common'||args.path==='@psibase/common-lib')return{path:'/common/common-lib.js',external:true};
  const from=args.resolveDir&&!args.resolveDir.startsWith(shared)?args.resolveDir:here;
  const req=createRequire(resolve(from,'package.json'));
  return{path:args.path==='qrcode'?req.resolve('qrcode/lib/browser.js'):entry(req,args.path)};
 });
}};
await build({entryPoints:['src/app.ts'],bundle:true,format:'esm',target:'es2022',outfile:'dist/app.js',minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},external:['/common/common-lib.js'],plugins:[npmResolver]});

// One stylesheet: the page's own rules in a layer of their own, then the shared-ui styles the
// account menu needs. shared-ui's base layer restyles every element of a page; this page is not
// built on it, so that layer is left out and account-menu.css resets only the menu's elements.
function withoutSharedBase(css){
 let out='',at=0;
 for(;;){
  const start=css.indexOf('@layer base{',at);
  if(start<0)return out+css.slice(at);
  let depth=0,end=start;
  for(;end<css.length;end++){if(css[end]==='{')depth++;else if(css[end]==='}'&&--depth===0)break;}
  out+=css.slice(at,start);at=end+1;
 }
}
const style=name=>{const dir=join(here,'node_modules',name),pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));return join(dir,pkg.exports?.['.']?.style??pkg.style??pkg.main);};
const input=join(here,'src/account-menu.css');
const compiler=await compile(await readFile(input,'utf8'),{base:dirname(input),from:input,onDependency(){},
 async customCssResolver(id){
  if(id.startsWith('@shared/'))return join(shared,id.slice(8));
  if(id==='tailwindcss'||id==='tw-animate-css')return style(id);
  if(id.startsWith('tailwindcss/'))return local.resolve(id);
 },
 async customJsResolver(id){if(!id.startsWith('.')&&!id.startsWith('/'))return local.resolve(id);},
});
const candidates=new Scanner({sources:compiler.sources}).scan();
const menu=withoutSharedBase(optimize(compiler.build(candidates),{minify:true}).code);
const page=await readFile('style.css','utf8');
const reset=await readFile('src/account-menu-reset.css','utf8');
if(menu.includes('@layer base'))throw Error('shared base layer was not removed');
await writeFile('dist/style.css',`@layer bridge,theme,base,components,utilities;\n@layer bridge{\n${page}\n}\n${menu}\n${reset}`);
await copyFile('index.html','dist/index.html');
console.log('BTC Bridge UI built');
