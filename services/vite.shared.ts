/// <reference types="node" />

import { Plugin, UserConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import alias from '@rollup/plugin-alias'

const outDirParams = {
    outDir: 'dist',
    emptyOutDir: true,
}

export interface SharedViteConfigOptions {
  projectDir: string
  manualChunks?: Record<string, string[]>
  additionalManualChunks?: Record<string, string[]>
  uiFramework?: string
}

export function createSharedViteConfig(options: SharedViteConfigOptions): Plugin {
  const { uiFramework = "react", manualChunks = {
    vendor: ['react', 'react-dom'],
  }, additionalManualChunks = {} } = options

  const rollupOptions = {
        cache: true,
        ...(uiFramework === "svelte" ? outDirParams : {}),
        output: {
            entryFileNames: 'index.js',
            assetFileNames: '[name][extname]',
            ...(Object.keys(manualChunks).length > 0 ? {
                manualChunks: {
                  // Core UI libraries
                  ...manualChunks,
                  ...additionalManualChunks
                }
              } : {})
        }
      };

  const userConfig: UserConfig = {
    build: {
      // Disable sourcemaps in production for better caching
      sourcemap: process.env.NODE_ENV === 'development',
      minify: process.env.NODE_ENV !== 'development',
      rollupOptions,
      // Increase chunk size warning limit
      chunkSizeWarningLimit: 1000
    },
    optimizeDeps: {
      // Enable dependency pre-bundling
      // TODO: this isn't right; what about manualChunks other than vendor?
      include: uiFramework === "react" ? (manualChunks.vendor || []) : [],
    },
  }
  return (uiFramework === "svelte") ? {
        name: 'shared-vite-config',
        ...userConfig
    } : {
        name: 'shared-vite-config',
        config: () => ({
            ...userConfig
        })
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
    uiFramework?: string;
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

const servicesDir = path.resolve(__dirname);

export function createPsibaseConfig(options: PsibaseConfigOptions): Plugin[] {
    const {
        uiFramework = "react",
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
            replacement: path.resolve(`${servicesDir}/user/CommonApi/common/resources$1`),
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
                `${servicesDir}/user/CommonApi/common/packages/common-lib/src`
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
                    ...(uiFramework !== "svelte" ? outDirParams : {}),
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