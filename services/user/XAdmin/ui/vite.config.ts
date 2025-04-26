import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { createSkipUnchangedBuildPlugin } from "../../../vite.shared";

const psibase = (_service: string, isServing?: boolean) => {
    const buildAliases = [
        {
            // bundle non-external (above) common files except fonts (which should only be referenced)
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve("../../CommonApi/common/resources$1"),
        },
    ];

    // if we're in dev mode, we need to alias the common-lib to the local source
    if (isServing) {
        buildAliases.push({
            find: /^@psibase\/common-lib.*$/,
            replacement: path.resolve(
                "../../CommonApi/common/packages/common-lib/src"
            ),
        });
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
                                // These are required by the wasm-transpiled package
                                "@bytecodealliance/preview2-shim/cli",
                                "@bytecodealliance/preview2-shim/clocks",
                                "@bytecodealliance/preview2-shim/filesystem",
                                "@bytecodealliance/preview2-shim/io",
                                "@bytecodealliance/preview2-shim/random",
                                // wasm-transpiled
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: "index.js",
                                assetFileNames: "[name][extname]",
                            },
                        },
                    },
                    server: {
                        host: "x-admin.psibase.127.0.0.1.sslip.io",
                        port: 8081,
                        proxy: {
                            "^/ws/.*": {
                                target: "ws://localhost:8080/",
                                ws: true,
                                rewrite: (path) => path.replace(/^\/ws/, ""),
                                timeout: 10000,
                            },
                            "/": {
                                target: "http://psibase.127.0.0.1.sslip.io:8080/",
                                autoRewrite: true,
                                bypass: (req, _res, _opt) => {
                                    if (
                                        req.url === "/" ||
                                        (req.method !== "POST" &&
                                            req.method !== "PUT" &&
                                            req.headers.accept !==
                                                "application/json" &&
                                            !req.url.startsWith("/common"))
                                    ) {
                                        return req.url;
                                    }
                                },
                                timeout: 10000,
                            },
                        },
                    },
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
export default defineConfig(({ command }) => ({
    plugins: [
        react({
            babel: {
                parserOpts: {
                    plugins: ["decorators-legacy"],
                },
            },
        }),
        psibase("__contract__(kebabCase)", command === "serve"),
        wasm(),
        topLevelAwait(),
        createSkipUnchangedBuildPlugin(__dirname)
    ],
    resolve: {
        alias: {
            "@/lib": path.resolve(__dirname, "./src/lib"),
            "@/components": path.resolve(__dirname, "./src/components"),
            "wasm-transpiled": path.resolve(
                __dirname,
                "./wasm-transpiled/x_admin"
            ),
        },
    },
    build: {
        // Enable build cache in a project-specific directory
        cacheDir: path.resolve(__dirname, ".vite-cache"),
        // Enable sourcemap for better caching
        sourcemap: true,
        minify: false,
    },
}));
