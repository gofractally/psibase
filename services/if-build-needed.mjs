import { shouldSkipBuild } from './build.shared.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = process.cwd();
const buildCmd = process.argv[process.argv.length - 1];

// Parse source:output directory pairs
const buildDirs = process.argv.slice(2, -1).map(dir => {
  const [source, output] = dir.split(':');
  return {
    source: path.resolve(projectDir, source),
    output: output ? path.resolve(projectDir, output) : path.resolve(projectDir, 'dist')
  };
});

// Add common-lib source directory if this isn't the common-lib project itself
if (!projectDir.includes('common-lib')) {
    buildDirs.push({ 
        source: path.resolve(scriptDir, 'user/CommonApi/common/packages/common-lib/src'),
        output: path.resolve(scriptDir, 'user/CommonApi/common/packages/common-lib/dist')
    });
}

if (shouldSkipBuild(projectDir, buildDirs)) {
    process.exit(0);
}

// Execute the build command
const { execSync } = await import('child_process');
execSync(buildCmd, { stdio: 'inherit' }); 