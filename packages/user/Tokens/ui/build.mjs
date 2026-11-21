import { cp, mkdir, rm } from 'node:fs/promises';
await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('./dist/plugin/web/prompt/transfer', import.meta.url), { recursive: true });
await mkdir(new URL('./dist/wallet-assets', import.meta.url), { recursive: true });
for (const file of ['transfer.mjs', 'transfer.css']) await cp(new URL(`./src/${file}`, import.meta.url), new URL(`./dist/wallet-assets/${file}`, import.meta.url));
await cp(new URL('./src/index.html', import.meta.url), new URL('./dist/plugin/web/prompt/transfer/index.html', import.meta.url));
await cp(new URL('../../CommonApi/common/packages/common-lib/dist/common-lib.js', import.meta.url), new URL('./dist/wallet-assets/common-lib.js', import.meta.url));
console.log('Built native Tokens transfer confirmation → dist/');
