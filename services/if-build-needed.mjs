import { shouldSkipBuild } from './build.shared.mjs';
import path from 'path';

const projectDir = process.cwd();
const buildCommand = process.argv[process.argv.length - 1];

// Parse source:output directory pairs
const buildDirs = process.argv.slice(2, -1).map(dir => {
  const [source, output] = dir.split(':');
  return {
    source: path.resolve(projectDir, source),
    output: output ? path.resolve(projectDir, output) : path.resolve(projectDir, 'dist')
  };
});

if (!shouldSkipBuild(projectDir, buildDirs)) {
  const { execSync } = await import('child_process');
  execSync(buildCommand, { stdio: 'inherit' });
} 