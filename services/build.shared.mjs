import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export function shouldSkipBuild(projectDir, additionalSrcDirs = []) {
  // Skip if REBUILD_ALWAYS is set to true
  if (process.env.PSIREBUILD === 'true') {
    console.log('No-rebuild functionality disabled (PSIREBUILD=true)');
    return false;
  }

  const srcDir = path.resolve(projectDir, 'src');
  const distDir = path.resolve(projectDir, 'dist');
  const cacheFile = path.resolve(projectDir, '.vite-cache/hash.json');

  // If dist directory doesn't exist or is empty, always build
  if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) {
    console.log('Building (dist folder missing or empty)');
    return false;
  }

  function calculateHash(dir, additionalSrcDirs = []) {
    const hash = createHash('md5');
    
    // Process main directory
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          hash.update(calculateHash(filePath));
        } else {
          hash.update(fs.readFileSync(filePath));
        }
      }
    }
    
    // Process additional source directories
    for (const additionalDir of additionalSrcDirs) {
      if (fs.existsSync(additionalDir)) {
        const additionalFiles = fs.readdirSync(additionalDir);
        for (const file of additionalFiles) {
          const filePath = path.join(additionalDir, file);
          const stat = fs.statSync(filePath);
          
          if (stat.isDirectory()) {
            hash.update(calculateHash(filePath));
          } else {
            hash.update(fs.readFileSync(filePath));
          }
        }
      }
    }
    
    return hash.digest('hex');
  }

  const currentHash = calculateHash(srcDir, additionalSrcDirs);
  let previousHash = '';

  try {
    if (fs.existsSync(cacheFile)) {
      previousHash = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).hash;
    }
  } catch (e) {
    // Ignore read errors
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