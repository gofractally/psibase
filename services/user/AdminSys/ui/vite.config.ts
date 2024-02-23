import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const psibase = (_appletContract: string, isServing?: boolean) => {
    const buildAliases = [
        {
            find: "/common/iframeResizer.contentWindow.js",
            replacement: path.resolve(
                "../../CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
            ),
        },
        {
            // bundle non-external (above) common files except fonts (which should only be referenced)
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve("../../CommonSys/common$1"),
        },
    ];

    // if we're in dev mode, we need to alias the common-lib to the local source
    if (isServing) {
        buildAliases.push({
            find: /^@psibase\/common-lib.*$/,
            replacement: path.resolve(
                "../../CommonSys/common/packages/common-lib/src"
            ),
        });
    }

    return [
        {
            name: "psibase",
            config: () => {
                return {
                    build: {
                        assetsDir: "",
                        cssCodeSplit: false,
                        rollupOptions: {
                            external: [
                                "/common/rootdomain.mjs",
                                "/common/common-lib.js",
                                "/common/iframeResizer.js",
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: "index.js",
                                assetFileNames: "[name][extname]",
                            },
                        },
                    },
                    server: {
                        host: "psibase.127.0.0.1.sslip.io",
                        port: 8081,
                        proxy: {
                            "^/ws/.*": {
                                target: "ws://localhost:8079/",
                                ws: true,
                                rewrite: (path) => path.replace(/^\/ws/, ""),
                                timeout: 10000,
                            },
                            "/": {
                                target: "http://psibase.127.0.0.1.sslip.io:8079/",
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
    ],
}));
