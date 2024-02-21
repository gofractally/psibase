import alias from "@rollup/plugin-alias";
import react from "@vitejs/plugin-react";
// @ts-ignore
import path from "path";
import { defineConfig } from "vite";
import mdPlugin, { Mode } from "vite-plugin-markdown";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

interface Options {
    server?: boolean;
    serviceName: string;
    isServing: boolean;
}

const psibase = (options: Options) => {
    const { serviceName, server, isServing } = {
        server: true,
        ...options,
    };
    if (!serviceName) throw new Error("Must have a service name");

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

    if (isServing) {
        buildAliases.push({
            find: "@psibase/common-lib",
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
                                "/common/iframeResizer.js",
                                "/common/iframeResizer.contentWindow.js",
                                "/common/common-lib.js",
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
            ],
        }),
    ];
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        tsconfigPaths(),
        svgr({ exportAsDefault: true }),
        react(),
        mdPlugin({ mode: [Mode.HTML] }),
        psibase({
            serviceName: "invite-sys",
            server: true,
            isServing: command === "serve",
        }),
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
}));
