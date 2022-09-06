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
                            "/": {
                                target: "http://psibase.127.0.0.1.sslip.io:8080/",
                                bypass: (req, _res, _opt) => {
                                    const host = req.headers.host || "";
                                    const subdomain = host.split(".")[0];
                                    if (
                                        subdomain === appletContract &&
                                        req.method !== "POST" &&
                                        req.headers.accept !==
                                            "application/json" &&
                                        !req.url.startsWith("/common") &&
                                        !req.url.startsWith("/api")
                                    ) {
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
                                    "../../CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
                                ),
                            "/common": path.resolve("../../CommonSys/common"),
                        },
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
    plugins: [react(), psibase("psispace-sys")],
});
