import { cp, mkdir, rm } from 'node:fs/promises';
await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('./dist/src', import.meta.url), { recursive: true });
for (const file of ['index.html', 'style.css']) await cp(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
await cp(new URL('./src', import.meta.url), new URL('./dist/src', import.meta.url), { recursive: true });
console.log('Built exchange UI → dist/');
