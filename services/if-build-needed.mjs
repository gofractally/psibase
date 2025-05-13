import { shouldSkipBuild } from './build.shared.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = process.cwd();

// Check for --recursive argument
let buildDirs = [];
const args = process.argv.slice(2);
if (args[0] === '--nonrecursive' && args[1]) {
    buildDirs = [{
        source: path.resolve(projectDir, args[1]),
        output: path.resolve(projectDir, 'dist'),
        recursive: false
    }];
    args.splice(0, 2); // Remove --recursive and its argument
}

const buildCmd = args[args.length - 1];
const sourceOutpuDirPairs = args.slice(0, -1);

let needSrcDistPair = true;
// Parse source:output directory pairs
buildDirs = buildDirs.concat(sourceOutpuDirPairs.map(dir => {
    const [source, output] = dir.split(':');
    if (source === "." || output === "dist") {
        needSrcDistPair = false;
    }
    return {
        source: path.resolve(projectDir, source),
        output: output ? path.resolve(projectDir, output) : path.resolve(projectDir, 'dist'),
    };
}));

// Add src:dist if not present
if (needSrcDistPair) {
    buildDirs.push({
        source: path.resolve(projectDir, "."),
        output: path.resolve(projectDir, "dist"),
    });
}

// Add common-lib source directory if this isn't the common-lib project itself
if (!projectDir.includes('common-lib')) {
    buildDirs.push({ 
        source: path.resolve(scriptDir, 'user/CommonApi/common/packages/common-lib'),
        output: path.resolve(scriptDir, 'user/CommonApi/common/packages/common-lib/dist'),
    });
}

if (shouldSkipBuild(projectDir, buildDirs)) {
    process.exit(0);
}

// Execute the build command
const { execSync } = await import('child_process');
execSync(buildCmd, { stdio: 'inherit' }); 