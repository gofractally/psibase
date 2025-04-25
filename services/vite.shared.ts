import { Plugin, UserConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export function createSkipUnchangedBuildPlugin(projectDir: string): Plugin {
  const cacheFile = path.resolve(projectDir, '.vite-cache/hash.json')
  const srcDir = path.resolve(projectDir, 'src')

  function calculateHash(dir: string): string {
    const hash = crypto.createHash('md5')
    const files = fs.readdirSync(dir)
    
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      
      if (stat.isDirectory()) {
        hash.update(calculateHash(filePath))
      } else {
        hash.update(fs.readFileSync(filePath))
      }
    }
    
    return hash.digest('hex')
  }

  return {
    name: 'skip-unchanged-build',
    buildStart() {
      if (!fs.existsSync(srcDir)) {
        return
      }

      const currentHash = calculateHash(srcDir)
      let previousHash = ''

      try {
        if (fs.existsSync(cacheFile)) {
          previousHash = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).hash
        }
      } catch (e) {
        // Ignore read errors
      }

      if (currentHash === previousHash) {
        console.log('No changes detected, skipping build...')
        process.exit(0)
      }

      // Ensure cache directory exists
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify({ hash: currentHash }))
    }
  }
}

export interface SharedViteConfigOptions {
  projectDir: string
  additionalPlugins?: Plugin[]
  additionalManualChunks?: Record<string, string[]>
}

export function createSharedViteConfig(options: SharedViteConfigOptions): UserConfig {
  const { projectDir, additionalPlugins = [], additionalManualChunks = {} } = options

  return {
    build: {
      // Generate manifest for caching
      manifest: true,
      // Disable sourcemaps in production for better caching
      sourcemap: process.env.NODE_ENV === 'development',
      // Configure Rollup caching
      rollupOptions: {
        cache: true,
        output: {
          manualChunks: {
            // Core UI libraries
            vendor: ['react', 'react-dom', 'react-router-dom'],
            ...additionalManualChunks
          }
        }
      },
      // Increase chunk size warning limit
      chunkSizeWarningLimit: 1000
    },
    optimizeDeps: {
      // Enable dependency pre-bundling
      include: [
        'react',
        'react-dom',
        'react-router-dom'
      ],
      // Use persistent cache for dependencies
      cacheDir: path.resolve(projectDir, '.vite-cache/deps')
    },
    // Enable caching of transform results
    cacheDir: path.resolve(projectDir, '.vite-cache'),
    plugins: [
      createSkipUnchangedBuildPlugin(projectDir),
      ...additionalPlugins
    ]
  }
} 