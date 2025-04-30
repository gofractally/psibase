import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export function shouldSkipBuild(projectDir, buildDirs = []) {
  // Skip if REBUILD_ALWAYS is set to true
  if (process.env.PSIREBUILD === 'true') {
    console.log('No-rebuild functionality disabled (PSIREBUILD=true)');
    return false;
  }

  // Check if any output directories are missing or empty
  for (const { output } of buildDirs) {
    if (!fs.existsSync(output) || fs.readdirSync(output).length === 0) {
      console.log(`Building (${path.relative(projectDir, output)} folder missing or empty)`);
      return false;
    }
  }

  function calculateHash(dir) {
    const hash = createHash('md5');
    
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          // Skip target directories as they are build outputs
          if (file === 'target') continue;
          hash.update(calculateHash(filePath));
        } else {
          hash.update(fs.readFileSync(filePath));
        }
      }
    }
    
    return hash.digest('hex');
  }

  // Calculate hash for all source directories
  const hash = createHash('md5');
  for (const { source } of buildDirs) {
    hash.update(calculateHash(source));
  }
  const currentHash = hash.digest('hex');

  const cacheFile = path.resolve(projectDir, '.vite-cache/hash.json');
  let previousHash = '';

  try {
    if (fs.existsSync(cacheFile)) {
      previousHash = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).hash;
    }
  } catch (e) {
    console.warn('Error reading cache file', e);
  }

  if (currentHash === previousHash) {
    console.log('Not building; No source changes.');
    return true;
  }

  console.log('Rebuilding (source files changed)');

  // Ensure cache directory exists
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify({ hash: currentHash }));
  return false;
} 