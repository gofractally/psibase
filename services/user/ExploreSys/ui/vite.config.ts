import { defineConfig } from "vite";
import path from "path";
import alias from "@rollup/plugin-alias";
// @ts-ignore
import { sveltekit } from "@sveltejs/kit/vite";
import { isoImport } from "vite-plugin-iso-import";
import svg from "@poppanator/sveltekit-svg";

const psibase = (appletContract: string) => {
    return [
        {
            name: "psibase",
            config: () => {
                return {
                    build: {
                        rollupOptions: {
                            external: [
                                "/common/rootdomain.mjs",
                                "/common/rpc.mjs",
                                "/common/iframeResizer.js",
                            ],
                        },
                    },
                    server: {
                        host: "psibase.127.0.0.1.sslip.io",
                        port: 8081,
                        proxy: {
                            "/": {
                                target: "http://psibase.127.0.0.1.sslip.io:8080",
                                // target: process.env.PSINET_URL,
                                bypass: (
                                    req: any,
                                    _res: any,
                                    _opt: any
                                ): any => {
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
    plugins: [
        isoImport(),
        sveltekit(),
        psibase("explore-sys"),
        // @ts-ignore
        svg({
            svgoOptions: {
                multipass: true,
                plugins: [
                    {
                        name: "preset-default",
                        params: { overrides: { removeViewBox: false } },
                    },
                ],
            },
        }),
    ],
});
