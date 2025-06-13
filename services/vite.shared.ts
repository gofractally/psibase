/// <reference types="node" />

import type { Plugin, UserConfig, Alias } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

import path from "path";
import fs from "fs";

const outDirParams = {
  outDir: "dist",
  emptyOutDir: true,
};

export interface SharedViteConfigOptions {
  projectDir: string;
  manualChunks?: Record<string, string[]>;
  additionalManualChunks?: Record<string, string[]>;
  uiFramework?: string;
}

export function createSharedViteConfig(
  options: SharedViteConfigOptions
): Plugin {
  const {
    uiFramework = "react",
    manualChunks = {
      vendor: ["react", "react-dom"],
    },
    additionalManualChunks = {},
  } = options;

  const rollupOptions = {
    cache: true,
    ...(uiFramework === "svelte" ? outDirParams : {}),
    output: {
      entryFileNames: "index.js",
      assetFileNames: "[name][extname]",
      dir: "dist",
      ...(Object.keys(manualChunks).length > 0
        ? {
            manualChunks: {
              // Core UI libraries
              ...manualChunks,
              ...additionalManualChunks,
            },
          }
        : {}),
    },
  };

  const userConfig: UserConfig = {
    build: {
      // Disable sourcemaps in production for better caching
      sourcemap: process.env.NODE_ENV === "development",
      minify: process.env.NODE_ENV !== "development",
      rollupOptions,
      // Increase chunk size warning limit
      chunkSizeWarningLimit: 1000,
    },
    optimizeDeps: {
      // Enable dependency pre-bundling
      // TODO: this isn't right; what about manualChunks other than vendor?
      include: uiFramework === "react" ? manualChunks.vendor || [] : [],
    },
  };
  return uiFramework === "svelte"
    ? {
        name: "shared-vite-config",
        ...userConfig,
      }
    : {
        name: "shared-vite-config",
        config: () => ({
          ...userConfig,
        }),
      };
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
  additionalProxies?: Record<
    string,
    {
      target: string;
      ws?: boolean;
      timeout?: number;
      rewrite?: (path: string) => string;
    }
  >;
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

const servicesDir = path.resolve(__dirname);

export function createPsibaseConfig(options: PsibaseConfigOptions): Plugin {
  const {
    uiFramework = "react",
    service,
    serviceDir,
    isServing = false,
    useHttps = process.env.VITE_SECURE_LOCAL_DEV === "true",
    proxyPort = 8080,
    additionalAliases = [],
    additionalProxyBypassConditions = [],
    additionalProxies = [],
  } = options;

  const buildAliases: Alias[] = [
    {
      find: "@",
      replacement: path.resolve(serviceDir, "./src"),
    },
    {
      find: /^\/common(?!\/(?:fonts))(.*)$/,
      replacement: path.resolve(
        `${servicesDir}/user/CommonApi/common/resources$1`
      ),
    },
    {
      find: /^@psibase\/common-lib.*$/,
      replacement: "/common/common-lib.js",
    },
    ...additionalAliases,
  ];

  if (isServing) {
    // TODO: this is contradictory to the above L131
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
        target: `${useHttps ? "https" : "http"}://psibase.127.0.0.1.sslip.io:${proxyPort}/`,
        changeOrigin: true,
        secure: !useHttps,
        autoRewrite: true,
        timeout: 10000,
        bypass: (req: any, _res: any, _opt: any) => {
          const host = req.headers.host || "";
          const subdomain = host.split(".")[0];
          const baseConditions = [
            subdomain === service,
            req.method !== "POST",
            req.headers.accept !== "application/json",
            !req.url.startsWith("/common"),
            !req.url.startsWith("/api"),
          ];
          return req.url === "/" ||
            [...baseConditions, ...additionalProxyBypassConditions].every(
              (condition) =>
                typeof condition === "function" ? condition(req) : condition
            )
            ? req.url
            : undefined;
        },
      },
    },
  };

  const pathToCerts: string = process.env.VITE_SECURE_PATH_TO_CERTS ?? "";

  if (useHttps) {
    baseServerConfig.https = {
      key: fs.readFileSync(
        `${pathToCerts}psibase.127.0.0.1.sslip.io+1-key.pem`,
        "utf8"
      ),
      cert: fs.readFileSync(
        `${pathToCerts}psibase.127.0.0.1.sslip.io+1.pem`,
        "utf8"
      ),
    };
  }

  return {
    name: "psibase",
    config: () => ({
      build: {
        ...(uiFramework !== "svelte" ? outDirParams : {}),
        assetsDir: "",
        cssCodeSplit: false,
        rollupOptions: {
          external: ["/common/rootdomain.mjs", "/common/common-lib.js"],
          makeAbsoluteExternalsRelative: false,
        },
      },
      server: baseServerConfig,
      resolve: {
        alias: buildAliases,
      },
    }),
  };
}

export const getSharedUIPlugins = (uiFramework: "react" | "svelte" = "react") => {
  return [
    uiFramework === "react" ? react() : undefined,
    tsconfigPaths(),
    tailwindcss(),
  ];
};