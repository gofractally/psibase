import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";

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
                                "/common/keyConversions.mjs",
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
                        alias: {
                            "/common/iframeResizer.contentWindow.js":
                                path.resolve(
                                    "../../../user/CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
                                ),
                            "/common": path.resolve(
                                "../../../user/CommonSys/common"
                            ),
                        },
                    },
                };
            },
        },
        alias({
            entries: [
                { find: "common/rpc.mjs", replacement: "/common/rpc.mjs" },
                {
                    find: "common/keyConversions.mjs",
                    replacement: "/common/keyConversions.mjs",
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
export default defineConfig({
    plugins: [react(), psibase("account-sys")],
});
