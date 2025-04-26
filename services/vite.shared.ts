import { Plugin, UserConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import alias from '@rollup/plugin-alias'

export function createSkipUnchangedBuildPlugin(projectDir: string): Plugin {
  // Skip if NO_REBUILD is set to false
  if (process.env.NO_REBUILD === 'false') {
    return {
      name: 'skip-unchanged-build',
      buildStart() {
        console.log('No-rebuild functionality disabled (NO_REBUILD=false)')
      }
    }
  }

  const cacheFile = path.resolve(projectDir, '.vite-cache/hash.json')
  const srcDir = path.resolve(projectDir, 'src')
  const distDir = path.resolve(projectDir, 'dist')

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

  function isDistEmpty(): boolean {
    if (!fs.existsSync(distDir)) {
      return true
    }
    const files = fs.readdirSync(distDir)
    return files.length === 0
  }

  return {
    name: 'skip-build-if-no-changes',
    buildStart() {
      if (!fs.existsSync(srcDir)) {
        return
      }

      const pkgName = path.basename(projectDir)

      // If dist directory doesn't exist or is empty, always build
      if (isDistEmpty()) {
        console.log(`Building ${pkgName} (dist folder missing or empty)`)
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
        console.log(`Not building ${pkgName}; No source changes.`)
        process.exit(0)
      }

      console.log(`Rebuilding ${pkgName} (source files changed)`)

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
    name: 'shared-vite-config',
    build: {
      // Generate manifest for caching
      manifest: true,
      // Disable sourcemaps in production for better caching
      sourcemap: process.env.NODE_ENV === 'development',
      minify: process.env.NODE_ENV !== 'development',
      // Enable build cache in a project-specific directory
      cacheDir: path.resolve(__dirname, ".vite-cache"),
      // Configure Rollup caching
      rollupOptions: {
        cache: true,
        // TODO: split this out to a createReactAppConfig() and include only in React apps
        output: {
          dir: "dist",
          manualChunks: {
            // Core UI libraries
            // TODO: these should only be for react apps; need a toggle
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

export function verifyViteCache(dirname: any) {
    // Ensure cache directory exists
    const cacheDir = path.resolve(dirname, ".vite-cache");
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
}

export interface PsibaseConfigOptions {
    service: string;
    serviceDir: string;
    isServing?: boolean;
    useHttps?: boolean;
    proxyPort?: number;
    additionalAliases?: Array<{ find: string | RegExp; replacement: string }>;
    additionalProxyBypassConditions?: Array<(req: any) => boolean>;
    additionalProxies?: Record<string, { target: string; ws?: boolean; timeout?: number; rewrite?: (path: string) => string }>;
}

interface ServerConfig {
    host: string;
    port: number;
    proxy: {
        "/": {
            target: string;
            changeOrigin: boolean;
            secure: boolean;
            autoRewrite: boolean;
            timeout?: number;
            bypass: (req: any, _res: any, _opt: any) => any;
        };
    };
    https?: {
        key: string;
        cert: string;
    };
}

export interface buildAlias{
    find: string | RegExp;
    replacement: string;
};

const servicesDir = path.resolve(__dirname, "/root/psibase/services");

export function createPsibaseConfig(options: PsibaseConfigOptions): Plugin[] {
    const {
        service,
        serviceDir,
        isServing = false,
        useHttps = false,
        proxyPort = 8080,
        additionalAliases = [],
        additionalProxyBypassConditions = [],
        additionalProxies = [],
    } = options;

    const buildAliases: buildAlias[] = [
        {
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve(`${servicesDir}/CommonApi/common/resources$1`),
        },
        {
            find: "@",
            replacement: path.resolve(serviceDir, "./src"),
        },
        ...additionalAliases,
    ];

    if (isServing) {
        buildAliases.push({
            find: /^@psibase\/common-lib.*$/,
            replacement: path.resolve(
                `${servicesDir}/CommonApi/common/packages/common-lib/src`
            ),
        });
    }

    const baseServerConfig: ServerConfig = {
        host: `${service}.psibase.127.0.0.1.sslip.io`,
        port: 8081,
        proxy: {
            ...additionalProxies,
            "/": {
                // Q: need to support both?
                target: `${useHttps ? 'https' : 'http'}://psibase.127.0.0.1.sslip.io:${proxyPort}/`,
                // Q: needed?
                changeOrigin: true,
                // Q: needed?
                secure: !useHttps,
                // Q: needed?
                autoRewrite: true,
                timeout: 10000,
                bypass: (req: any, _res: any, _opt: any) => {
                    const host = req.headers.host || "";
                    const subdomain = host.split(".")[0];
                    // TODO: this list doesn't match the list in XAdmin
                    const baseConditions = [
                        subdomain === service,
                        req.method !== "POST",
                        req.headers.accept !== "application/json",
                        !req.url.startsWith("/common"),
                        !req.url.startsWith("/api"),
                    ];
                    // following is just a big if statement
                    return req.url === "/" || [...baseConditions, ...additionalProxyBypassConditions].every(condition => 
                        typeof condition === 'function' ? condition(req) : condition
                    ) ? req.url : undefined;
                },
            },
        },
    };

    if (useHttps) {
        baseServerConfig.https = {
            key: fs.readFileSync(
                `${process.env.VITE_SECURE_PATH_TO_CERTS}psibase.127.0.0.1.sslip.io+1-key.pem`,
                "utf8",
            ),
            cert: fs.readFileSync(
                `${process.env.VITE_SECURE_PATH_TO_CERTS}psibase.127.0.0.1.sslip.io+1.pem`,
                "utf8",
            ),
        };
    }

    return [
        {
            name: "psibase",
            config: () => ({
                build: {
                    assetsDir: "",
                    cssCodeSplit: false,
                    rollupOptions: {
                        external: [
                            "/common/rootdomain.mjs",
                            "/common/common-lib.js",
                            "@bytecodealliance/preview2-shim/cli",
                            "@bytecodealliance/preview2-shim/clocks",
                            "@bytecodealliance/preview2-shim/filesystem",
                            "@bytecodealliance/preview2-shim/io",
                            "@bytecodealliance/preview2-shim/random"
                        ],
                        makeAbsoluteExternalsRelative: false,
                        output: {
                            entryFileNames: 'index.js',
                            assetFileNames: '[name][extname]',
                        },
                    },
                },
                // TODO: No server entry in Producers at all
                server: baseServerConfig,
                resolve: {
                    alias: buildAliases,
                },
            }),
        },
        alias({
            entries: [
                {
                    find: /^@psibase\/common-lib.*$/,
                    replacement: "/common/common-lib.js",
                },
            ],
        }),
    ];
}