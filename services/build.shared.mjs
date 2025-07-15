import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export function shouldSkipBuild(projectDir, buildDirs = []) {
  // Skip if PSIREBUILD is set to true
  if (process.env.PSIREBUILD === 'true') {
    console.log('No-rebuild functionality disabled (PSIREBUILD=true)');
    return false;
  }

  // Validate source directories and output parent directories exist
  for (const { source, output } of buildDirs) {
    if (!fs.existsSync(source)) {
      console.error(`Error: Source directory does not exist: ${path.relative(projectDir, source)}`);
      process.exit(1);
    }
    const outputParent = path.dirname(output);
    if (!fs.existsSync(outputParent)) {
      console.error(`Error: Output parent directory does not exist: ${path.relative(projectDir, outputParent)}`);
      process.exit(1);
    }
  }

  // Check if any output directories are missing or empty
  for (const { output } of buildDirs) {
    if (!fs.existsSync(output) || fs.readdirSync(output).length === 0) {
      console.log(`Building (${path.relative(projectDir, output)} folder missing or empty)`);
      return false;
    }
  }

  function calculateFileHashes(dir) {
    const fileHashes = new Map();
    
    if (fs.existsSync(dir)) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const filePath = path.join(dir, item);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          // Skip target and dist directories as they are build outputs
          if (item === 'target' || item === '.tmp' || item === 'dist' || item === '.vite-cache' || item === '.svelte-kit') continue;
          const subHashes = calculateFileHashes(filePath);
          for (const [subPath, hash] of subHashes) {
            fileHashes.set(subPath, hash);
          }
        } else {
          const hash = createHash('md5');
          hash.update(fs.readFileSync(filePath));
          fileHashes.set(path.relative(projectDir, filePath), hash.digest('hex'));
        }
      }
    }
    
    return fileHashes;
  }

  // Calculate hashes for all source directories
  const currentFileHashes = new Map();
  for (const { source } of buildDirs) {
    const sourceHashes = calculateFileHashes(source);
    for (const [filePath, hash] of sourceHashes) {
      currentFileHashes.set(filePath, hash);
    }
  }

  const cacheFile = path.resolve(projectDir, '.vite-cache/hash.json');
  let previousFileHashes = new Map();

  try {
    if (fs.existsSync(cacheFile)) {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      previousFileHashes = new Map(Object.entries(cache.fileHashes || {}));
    }
  } catch (e) {
    console.warn('Error reading cache file', e);
  }

  // Find changed files
  const changedFiles = [];
  for (const [filePath, currentHash] of currentFileHashes) {
    const previousHash = previousFileHashes.get(filePath);
    if (!previousHash || previousHash !== currentHash) {
      changedFiles.push(filePath);
    }
  }

  // Check for deleted files
  for (const [filePath] of previousFileHashes) {
    if (!currentFileHashes.has(filePath)) {
      changedFiles.push(filePath + ' (deleted)');
    }
  }

  if (changedFiles.length === 0) {
    console.log('Not building; No source changes.');
    return true;
  }

  console.log('Rebuilding (source files changed):');
  for (const file of changedFiles) {
    console.log(`  ${file}`);
  }

  // Ensure cache directory exists
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify({
    fileHashes: Object.fromEntries(currentFileHashes)
  }));
  return false;
} 
