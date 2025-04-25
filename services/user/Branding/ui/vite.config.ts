import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import * as fs from "fs";
import alias from "@rollup/plugin-alias";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";
import { createSkipUnchangedBuildPlugin } from "../../../vite.shared";

const psibase = (service: string, isServing?: boolean) => {
    const buildAliases = [
        {
            // bundle non-external (above) common files except fonts (which should only be referenced)
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve("../../CommonApi/common/resources$1"),
        },
        {
            find: "@",
            replacement: path.resolve(__dirname, "./src"),
        }
    ];

    // if we're in dev mode, we need to alias the common-lib to the local source
    if (isServing) {
        buildAliases.push({
            find: /^@psibase\/common-lib.*$/,
            replacement: path.resolve(
                "../../CommonApi/common/packages/common-lib/src",
            ),
        });
    }

    const runLocalHttpsDev = process.env.VITE_SECURE_LOCAL_DEV === "true";
    const pathToCerts: string = process.env.VITE_SECURE_PATH_TO_CERTS ?? "";

    // establish base server config (http)
    const httpServerConfig = {
        host: "psibase.127.0.0.1.sslip.io",
        port: 8081,
        proxy: {
            "/": {
                bypass: (req, _res, _opt) => {
                    const host = req.headers.host || "";
                    const subdomain = host.split(".")[0];
                    if (
                        subdomain === service &&
                        req.method !== "POST" &&
                        req.headers.accept !== "application/json" &&
                        !req.url.startsWith("/messages") &&
                        !req.url.startsWith("/common") &&
                        !req.url.startsWith("/api")
                    ) {
                        return req.url;
                    }
                },
            },
        },
    };

    let serverConfig;
    // supplement/upate server config if https flag is set in .env
    if (runLocalHttpsDev) {
        serverConfig = {
            ...httpServerConfig,
            https: {
                key: fs.readFileSync(
                    `${pathToCerts}psibase.127.0.0.1.sslip.io+1-key.pem`,
                    "utf8",
                ),
                cert: fs.readFileSync(
                    `${pathToCerts}psibase.127.0.0.1.sslip.io+1.pem`,
                    "utf8",
                ),
            },
            proxy: {
                "/": {
                    ...httpServerConfig.proxy["/"],
                    target: "https://psibase.127.0.0.1.sslip.io:8080/",
                    // disable dev server forcing security to the chain
                    secure: false,
                },
            },
        };
    } else {
        serverConfig = {
            ...httpServerConfig,
            proxy: {
                "/": {
                    ...httpServerConfig.proxy["/"],
                    target: "http://psibase.127.0.0.1.sslip.io:8080/",
                },
            },
        };
    }

    return [
        {
            name: "psibase",
            config: () => {
                return {
                    build: {
                        // Enable build cache in a project-specific directory
                        cacheDir: path.resolve(__dirname, ".vite-cache"),
                        // Enable sourcemap for better caching
                        sourcemap: true,
                        assetsDir: "",
                        cssCodeSplit: false,
                        rollupOptions: {
                            external: [
                                "/common/rootdomain.mjs",
                                "/common/common-lib.js",
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: "index.js",
                                assetFileNames: "[name][extname]",
                                // Enable chunk splitting for better caching
                                manualChunks: {
                                    // Radix UI components
                                    'radix-ui': [
                                        '@radix-ui/react-dropdown-menu',
                                        '@radix-ui/react-label',
                                        '@radix-ui/react-separator',
                                        '@radix-ui/react-slot',
                                        '@radix-ui/react-tabs',
                                        '@radix-ui/react-tooltip'
                                    ],
                                    // Animation libraries
                                    animation: ['framer-motion'],
                                    // UI utilities
                                    'ui-utils': [
                                        'class-variance-authority',
                                        'clsx',
                                        'tailwind-merge',
                                        'tailwindcss-animate',
                                        'lucide-react'
                                    ],
                                }
                            },
                        },
                    },
                    server: serverConfig,
                    resolve: {
                        alias: buildAliases,
                    },
                };
            },
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
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    const psibaseConfig = psibase("branding", command === "serve");
    return {
        plugins: [
            react(),
            ...psibaseConfig,
            wasm(),
            topLevelAwait(),
            tsconfigPaths(),
            createSkipUnchangedBuildPlugin(path.dirname(__filename))
        ],
    };
});
