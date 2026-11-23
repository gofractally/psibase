// Serve the exact production builds. Tests replace the native RPC boundary,
// never app components; no requests reach a persistent wallet or chain.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mappings = [
  ['/exchange/', 'packages/user/Exchange/ui/dist'],
  ['/tokens/', 'packages/user/Tokens/ui/dist'],
  ['/favor/', 'packages/user/Favor/ui/dist'],
  ['/btcbridge/', 'packages/user/BtcBridge/ui/dist'],
  ['/ethbridge/', 'packages/user/EthBridge/ui'],
  ['/homepage/', 'packages/user/Homepage/ui/dist'],
  ['/login/', 'packages/user/Host/LoginPrompt/ui/dist'],
  ['/config/', 'packages/user/Config/ui/dist'],
  ['/permissions/', 'packages/user/Permissions/ui/dist'],
  ['/explorer/', 'packages/user/Explorer/ui/dist'],
  ['/workshop/', 'packages/user/Workshop/ui/dist'],
  ['/supervisor/', 'packages/user/Supervisor/ui/dist'],
  ['/fractalcore/', 'packages/user/FractalCore/ui/dist'],
  ['/fractals/', 'packages/user/Fractals/ui/dist'],
  ['/identity/', 'packages/user/Identity/ui/dist'],
  ['/evaluations/', 'packages/user/Evaluations/ui/dist'],
  ['/tokenstream/', 'packages/user/TokenStream/ui/dist'],
  ['/plugin-tester/', 'packages/user/CommonApi/common/packages/plugin-tester/ui/dist'],
  ['/x-admin/', 'packages/local/XAdmin/ui/dist'],
  ['/x-proxy/', 'packages/local/XProxy/ui/dist'],
  ['/common/plugin-tester/', 'packages/user/CommonApi/common/packages/plugin-tester/ui/dist'],
  ['/common/', 'packages/user/CommonApi/common/packages/common-lib/dist'],
  ['/wallet-assets/', 'packages/user/Tokens/ui/dist/wallet-assets'],
];
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};
async function file(base, relative) {
  const directory = resolve(root, base);
  const path = resolve(directory, relative);
  if (path !== directory && !path.startsWith(directory + sep)) return null;
  try {
    if (!(await stat(path)).isFile()) return null;
    return { data: await readFile(path), type: mime[extname(path)] || 'application/octet-stream' };
  } catch { return null; }
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/__health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, mode: 'built-ui-contract-tests' })); return;
  }
  let path;
  try { path = decodeURIComponent(url.pathname); }
  catch { response.writeHead(400); response.end(); return; }
  let result;
  const hostname = String(request.headers.host || '').split(':')[0];
  const service = hostname.endsWith('.localhost') ? hostname.split('.')[0] : null;
  const aliases = {
    network: 'homepage', host: 'login', perms: 'permissions',
    'token-stream': 'tokenstream', 'fractal-core': 'fractalcore',
    'demo-frac': 'fractalcore', evaluation: 'evaluations',
  };
  const servicePrefix = '/' + (aliases[service] || service) + '/';
  const named = service && mappings.find(([prefix]) => prefix === servicePrefix);
  // Root-based React routers use the same named-account origins as deployment.
  if (named && !path.startsWith('/common/') && !path.startsWith('/wallet-assets/')) {
    result = await file(named[1], path.slice(1) || 'index.html');
    if (!result && !extname(path)) result = await file(named[1], 'index.html');
  }
  for (const [prefix, directory] of mappings) {
    if (result) break;
    if (path === prefix.slice(0, -1)) {
      response.writeHead(302, { location: prefix + url.search }); response.end(); return;
    }
    if (path.startsWith(prefix)) {
      const relative = path.slice(prefix.length) || 'index.html';
      result = await file(directory, relative);
      if (!result && !extname(relative)) result = await file(directory, 'index.html');
      break;
    }
  }
  // Vite production asset URLs are absolute; each content hash is unique.
  if (!result && (path.startsWith('/assets/') || path.startsWith('/fonts/'))) {
    for (const [, directory] of mappings) {
      result = await file(directory, path.slice(1));
      if (result) break;
    }
  }
  if (!result) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'content-type': result.type, 'cache-control': 'no-store' });
  response.end(result.data);
});
server.listen(Number(process.env.PSIBASE_UI_TEST_PORT || 4179), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
