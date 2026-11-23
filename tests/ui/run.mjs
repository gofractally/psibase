// One entry point for the Yarn apps AND the standalone npm apps. A UI outside
// packages/package.json must not silently escape the release regression gate.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'build-app-regression/ui');
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!['--install', '--skip-build'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
}
if (Number(process.versions.node.split('.')[0]) !== 22) {
  throw new Error('Use Node 22 (see .nvmrc) for the pinned Yarn Plug\'n\'Play loader.');
}
if (process.env.CI && flags.has('--skip-build')) throw new Error('CI must test fresh production builds.');
await mkdir(output, { recursive: true });
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  node: process.version,
  nativeBoundary: 'Browser fixtures; no WASM plugin execution, signatures or chain transactions',
  skippedBuild: flags.has('--skip-build'),
  steps: [],
};
const steps = [];
const add = (name, cwd, command, args) => steps.push({ name, cwd, command, args });
const yarn = (name, args) => add(name, 'packages', 'corepack', ['yarn', ...args]);
const npm = (name, cwd, args) => add(name, cwd, 'npm', args);
if (flags.has('--install')) {
  yarn('Install shared workspace (immutable)', ['install', '--immutable']);
  for (const app of ['Favor', 'BtcBridge']) {
    npm(`Install ${app} (locked)`, `packages/user/${app}/ui`, ['ci', '--no-audit', '--no-fund']);
  }
  npm('Install browser runner (locked)', 'tests/ui', ['ci', '--no-audit', '--no-fund']);
  npm('Install Chromium', 'tests/ui', ['exec', '--', 'playwright', 'install', 'chromium']);
}
if (!flags.has('--skip-build')) {
  yarn('Build all shared apps and common-lib', ['build:all']);
  for (const app of ['Exchange', 'Tokens', 'Favor', 'BtcBridge']) {
    npm(`Build ${app}`, `packages/user/${app}/ui`, ['run', 'build']);
  }
  add('Check static EthBridge JavaScript', '.', process.execPath, ['--check', 'packages/user/EthBridge/ui/app.js']);
}
yarn('Supervisor UI tests', ['workspace', '@psibase/supervisor-ui', 'test']);
yarn('XAdmin UI tests', ['workspace', '@psibase/xadmin-ui', 'test']);
for (const app of ['Exchange', 'Tokens', 'Favor']) {
  npm(`${app} UI tests`, `packages/user/${app}/ui`, ['test']);
}
npm('Chromium production UI contracts', 'tests/ui', ['test']);

for (const [index, step] of steps.entries()) {
  const logPath = resolve(output, `${String(index + 1).padStart(2, '0')}.log`);
  console.log(`\n[${index + 1}/${steps.length}] ${step.name}`);
  const log = createWriteStream(logPath);
  const started = performance.now();
  const child = spawn(step.command, step.args, {
    cwd: resolve(root, step.cwd),
    env: { ...process.env, PSIREBUILD: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
  child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
  const result = await new Promise(resolveResult => {
    child.once('error', error => resolveResult({ exitCode: 1, error: error.message }));
    child.once('close', (code, signal) => resolveResult({ exitCode: code ?? 1, signal }));
  });
  await new Promise((done, reject) => {
    log.once('error', reject);
    log.end(done);
  });
  report.steps.push({ ...step, ...result, seconds: +((performance.now() - started) / 1000).toFixed(3), log: logPath });
  report.finishedAt = new Date().toISOString();
  report.passed = result.exitCode === 0 && report.steps.length === steps.length;
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  if (result.exitCode !== 0) {
    console.error(`Failed: ${step.name}. See ${logPath}`);
    process.exitCode = 1;
    break;
  }
}
if (report.passed) console.log(`\nAll UI gates passed. Report: ${resolve(output, 'results.json')}`);
