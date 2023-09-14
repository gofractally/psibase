import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
import wasm from 'vite-plugin-wasm';
import topLevelAwait from "vite-plugin-top-level-await";


const psibase = (appletContract: string) => {
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
                                "/common/rpc.mjs",
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
                                        req.url === "/" || (
                                            req.method !== "POST"
                                         && req.method !== "PUT"
                                         && req.headers.accept !== "application/json"
                                         && !req.url.startsWith("/common")
                                         )
                                    ) {
                                        return req.url;
                                    }
                                },
                                timeout: 10000,
                            },
                        },
                    },
                    resolve: {
                        alias: [
                            {
                                find: "/common/iframeResizer.contentWindow.js",
                                replacement: path.resolve(
                                    "../../CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
                                ),
                            },
                            {
                                // bundle non-external (above) common files except fonts (which should only be referenced)
                                find: /^\/common(?!\/(?:fonts))(.*)$/,
                                replacement: path.resolve(
                                    "../../CommonSys/common$1"
                                ),
                            },
                        ],
                    },
                };
            },
        },
        alias({
            entries: [
                { find: "common/rpc.mjs", replacement: "/common/rpc.mjs" },
            ],
        }),
    ];
};

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react({
            babel: {
                parserOpts: {
                    plugins: ["decorators-legacy"],
                },
            },
        }),
        psibase("__contract__(kebabCase)"),
        wasm(),
        topLevelAwait()
    ],
});
