import { shouldSkipBuild } from './build.shared.mjs';

const projectDir = process.cwd();
const additionalSrcDirs = process.argv.slice(2, -1);
const buildCommand = process.argv[process.argv.length - 1];

if (!shouldSkipBuild(projectDir, additionalSrcDirs)) {
  const { execSync } = await import('child_process');
  execSync(buildCommand, { stdio: 'inherit' });
} 