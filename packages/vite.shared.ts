/// <reference types="node" />
import type { Alias, ConfigEnv, Plugin, UserConfig } from "vite";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import tsconfigPaths from "vite-tsconfig-paths";

const outDirParams = {
    outDir: "dist",
    emptyOutDir: true,
};

export interface SharedViteConfigOptions {
    manualChunks?: Record<string, string[]>;
    additionalManualChunks?: Record<string, string[]>;
    uiFramework?: string;
}

export function createSharedViteConfig(
    options?: SharedViteConfigOptions,
): Plugin {
    const {
        uiFramework = "react",
        manualChunks = {
            vendor: ["react", "react-dom"],
        },
        additionalManualChunks = {},
    } = options ?? {};

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

export function verifyViteCache(dirname: string) {
    // Ensure cache directory exists
    const cacheDir = path.resolve(dirname, ".vite-cache");
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
}

export interface PsibaseConfigOptions {
    uiFramework?: string;
    appDirectory: string;
    bundleCommonLib?: boolean;
    additionalAliases?: Array<{ find: string | RegExp; replacement: string }>;
}

const servicesDir = path.resolve(__dirname);

export function createPsibaseConfig(
    config: ConfigEnv,
    options: PsibaseConfigOptions,
): Plugin {
    const isDevServer = config.command === "serve";

    const {
        uiFramework = "react",
        appDirectory,
        bundleCommonLib = false,
        additionalAliases = [],
    } = options;

    const commonLibSourcePath = path.resolve(
        `${servicesDir}/user/CommonApi/common/packages/common-lib/src`,
    );

    const buildAliases: Alias[] = [
        {
            find: "@",
            replacement: path.resolve(appDirectory, "./src"),
        },
        {
            find: /^@psibase\/common-lib.*$/,
            replacement:
                isDevServer || bundleCommonLib
                    ? commonLibSourcePath
                    : "/common/common-lib.js",
        },
        ...additionalAliases,
    ];

    return {
        name: "psibase",
        config: () => ({
            server: {
                port: 8081,
            },
            build: {
                ...(uiFramework !== "svelte" ? outDirParams : {}),
                assetsDir: "",
                cssCodeSplit: false,
                rollupOptions: {
                    external: [
                        "/common/rootdomain.mjs",
                        ...(bundleCommonLib ? [] : ["/common/common-lib.js"]),
                    ],
                    makeAbsoluteExternalsRelative: false,
                },
            },
            resolve: {
                alias: buildAliases,
            },
        }),
    };
}

export const getSharedUIPlugins = (
    uiFramework: "react" | "svelte" = "react",
) => {
    return [
        uiFramework === "react" ? react() : undefined,
        tsconfigPaths(),
        tailwindcss(),
    ];
};
