import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import svgr from "vite-plugin-svgr";
import mdPlugin, { Mode } from "vite-plugin-markdown";

// @ts-ignore
import path from "path";
import alias from "@rollup/plugin-alias";

interface Options {
    server?: boolean;
    serviceName: string;
}

const psibase = (options: Options) => {
    const { serviceName, server } = {
        server: true,
        ...options,
    };
    if (!serviceName) throw new Error("Must have a service name");

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
                                "/common/keyConversions.mjs",
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: "index.js",
                                assetFileNames: "[name][extname]",
                            },
                        },
                    },
                    ...(server && {
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
                                            subdomain === serviceName &&
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
                    }),
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
                {
                    find: "common/rpc.mjs",
                    replacement:
                        "http://psibase.127.0.0.1.sslip.io:8080/common/rpc.mjs",
                },
                {
                    find: "common/keyConversions.mjs",
                    replacement:
                        "http://psibase.127.0.0.1.sslip.io:8080/common/keyConversions.mjs",
                },
            ],
        }),
    ];
};

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        tsconfigPaths(),
        svgr({ exportAsDefault: true }),
        react(),
        mdPlugin({ mode: [Mode.HTML] }),
        psibase({ serviceName: "psiboard", server: true }),
    ],
    resolve: {
        // These aliases are the second stage of translation when locating a local resource.
        // First the paths in tsconfig.json translates the import statement's path to a path on the drive.
        // Then these aliases will replace the result.
        alias: {
            "@toolbox/components": "components",
            process: "process/browser",
        },
    },
    publicDir: "public",
});
