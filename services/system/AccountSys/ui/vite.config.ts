import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
import svgr from "vite-plugin-svgr";

const psibase = (appletContract: string, isServing?: boolean) => {
    const buildAliases = [
        {
            find: "/common/iframeResizer.contentWindow.js",
            replacement: path.resolve(
                "../../../user/CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
            ),
        },
        {
            // bundle non-external (above) common files except fonts (which should only be referenced)
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve("../../../user/CommonSys/common$1"),
        },
    ];

    if (isServing) {
        buildAliases.push({
            find: "@psibase/common-lib",
            replacement: path.resolve(
                "../../../user/CommonSys/common/packages/common-lib/src"
            ),
        });
    }

    return [
        {
            name: "psibase",
            config: () => {
                return {
                    build: {
                        target: "esnext",
                        optimizeDeps: {
                            esbuildOptions: {
                                target: "esnext", // you can also use 'es2020' here
                            },
                        },
                        assetsDir: "",
                        cssCodeSplit: false,
                        rollupOptions: {
                            external: [
                                "/common/rootdomain.mjs",
                                "/common/common-lib.js",
                                "/common/iframeResizer.js",
                                "/common/useLocalStorage.mjs",
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: "index.js",
                                assetFileNames: "[name][extname]",
                            },
                        },
                        // target: "es2022",
                    },
                    server: {
                        host: "psibase.127.0.0.1.sslip.io",
                        port: 8081,
                        proxy: {
                            "/": {
                                target: "http://psibase.127.0.0.1.sslip.io:8080/",
                                bypass: (req, _res, _opt) => {
                                    const host = req.headers.host || "";
                                    const subdomain = host.split(".")[0];
                                    const bBypass =
                                        subdomain === appletContract &&
                                        req.method !== "POST" &&
                                        req.headers.accept !==
                                            "application/json" &&
                                        !req.url.startsWith("/common") &&
                                        !req.url.startsWith("/api");
                                    if (bBypass) {
                                        return req.url;
                                    }
                                },
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
                    find: "@psibase/common-lib",
                    replacement: "/common/common-lib.js",
                },
                {
                    find: "common/useLocalStorage.mjs",
                    replacement: "/common/useLocalStorage.mjs",
                },
            ],
        }),
    ];
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        svgr({ exportAsDefault: true }),
        psibase("account-sys", command === "serve"),
    ],
}));
