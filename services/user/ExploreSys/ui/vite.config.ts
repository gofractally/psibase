import { defineConfig } from "vite";
import path from "path";
import alias from "@rollup/plugin-alias";
// @ts-ignore
import { sveltekit } from "@sveltejs/kit/vite";
import { isoImport } from "vite-plugin-iso-import";
import svg from "@poppanator/sveltekit-svg";

const psibase = (service: string, isServing?: boolean) => {
    const buildAliases = [
        {
            // bundle non-external (above) common files except fonts (which should only be referenced)
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve("../../CommonApi/common/resources$1"),
        },
    ];

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
                        rollupOptions: {
                            external: [
                                "/common/rootdomain.mjs",
                                "/common/common-lib.js",
                            ],
                            makeAbsoluteExternalsRelative: false,
                        },
                    },
                    server: {
                        host: "psibase.127.0.0.1.sslip.io",
                        port: 8081,
                        proxy: {
                            "/": {
                                target: "http://psibase.127.0.0.1.sslip.io:8079",
                                bypass: (
                                    req: any,
                                    _res: any,
                                    _opt: any
                                ): any => {
                                    const host = req.headers.host || "";
                                    const subdomain = host.split(".")[0];
                                    if (
                                        subdomain === service &&
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
        isoImport(),
        sveltekit(),
        psibase("explore-sys", command === "serve"),
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
}));
