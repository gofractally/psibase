#!/usr/bin/env python3
"""Publish Favor's services, plugin and UI to existing psibase service accounts.
No application proxy or separate UI server is used. Secrets remain in memory.
"""
import argparse,json,secrets,subprocess
from pathlib import Path
from urllib.parse import urlsplit
p=argparse.ArgumentParser()
p.add_argument('--cli',default='psibase')
p.add_argument('--tool',default='cargo-psibase')
p.add_argument('--psitest',default='psitest')
p.add_argument('--api',required=True,help='Chain root URL, for example http://psibase.localhost:8089/')
p.add_argument('--target-dir',type=Path,default=Path('target'))
p.add_argument('--legacy',action='store_true',help='Use transact:plugin/intf on older 0.29 chains')
p.add_argument('--init-key',action='store_true',help='Provision a new routing key; also invalidates existing previews')
p.add_argument('--sign',action='append',default=[],help='Signing-key file, passed to psibase without reading or printing it')
a=p.parse_args();root=Path(__file__).resolve().parent;target=a.target_dir.resolve()
flags=['-a',a.api]
for key in a.sign:flags+=['--sign',key]
def run(command,**kwargs):subprocess.run(command,check=True,**kwargs)
def push(actions):
 r=subprocess.run([a.cli,'push',*flags,'--console=false','-'],input=json.dumps(actions),text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
def action(service,method,data):return {'sender':'favor','service':service,'method':method,'data':data}
run(['node',str(root/'ui/build.mjs')])
run([a.tool,'psibase','--manifest-path',str(root/'Cargo.toml'),'--target-dir',str(target),'--psitest',a.psitest,'package'])
wasm=target/'wasm32-wasip1/release'
plugin=wasm/'favor_plugin.wasm'
if a.legacy:
 run(['cargo','component','build','--manifest-path',str(root/'plugin-legacy/Cargo.toml'),'--target-dir',str(target),'--target','wasm32-wasip1','--release'])
 plugin=wasm/'favor_plugin_legacy.wasm'
for service,file in [('favor','favor'),('favor+1','r-favor')]:
 run([a.cli,'deploy',*flags,service,str(wasm/(file+'.wasm')),str(wasm/(file+'.schema.json'))])
push([action('http','registerServer',{'server':'favor+1'}),action('dyn-ld','link',{'group':'Favor','deps':[{'name':name,'service':service} for name,service in [('favor','favor'),('r-favor','favor+1'),('host','host'),('transact','transact'),('permissions','perms'),('profiles','profiles'),('accounts','accounts')]]})])
if a.init_key:push([action('favor','rotate_key',{'secret':secrets.token_hex(32)})])
run([a.cli,'upload',*flags,'-S','favor','-r',str(root/'ui/dist'),'/'])
run([a.cli,'upload',*flags,'-S','favor','-t','application/wasm',str(plugin),'/plugin.wasm'])
u=urlsplit(a.api);print('Favor hosted on chain:',f'{u.scheme}://favor.{u.netloc}/')
