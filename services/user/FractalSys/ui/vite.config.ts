import alias from "@rollup/plugin-alias";
import react from "@vitejs/plugin-react";
import * as fs from "fs";
// @ts-ignore
import path from "path";
import { defineConfig, loadEnv } from "vite";
import mdPlugin, { Mode } from "vite-plugin-markdown";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";


interface Options {
    server?: boolean;
    serviceName: string;
    env: any;
}

const psibase = (options: Options) => {
    const { serviceName, server } = {
        server: true,
        ...options,
    };
    if (!serviceName) throw new Error("Must have a service name");

    const runLocalHttpsDev =
        (options.env.VITE_SECURE_LOCAL_DEV as string) === "true";
    const pathToCerts: string = options.env.VITE_SECURE_PATH_TO_CERTS ?? "";

    // establish base server config (http)
    const httpServerConfig = {
        host: "psibase.127.0.0.1.sslip.io",
        port: 8081,
        proxy: {
            "/": {
                bypass: (req, _res, _opt) => {
                    const host = req.headers.host || "";
                    const subdomain = host.split(".")[0];
                    if (
                        subdomain === serviceName &&
                        req.method !== "POST" &&
                        req.headers.accept !== "application/json" &&
                        !req.url.startsWith("/common") &&
                        !req.url.startsWith("/api")
                    ) {
                        return req.url;
                    }
                },
            },
        },
    };
    let serverConfig;
    // supplement/upate server config if https flag is set in .env
    if (runLocalHttpsDev) {
        serverConfig = {
            ...httpServerConfig,
            https: {
                key: fs.readFileSync(
                    `${pathToCerts}psibase.127.0.0.1.sslip.io+1-key.pem`,
                    "utf8"
                ),
                cert: fs.readFileSync(
                    `${pathToCerts}psibase.127.0.0.1.sslip.io+1.pem`,
                    "utf8"
                ),
            },
            proxy: {
                "/": {
                    ...httpServerConfig.proxy["/"],
                    target: "https://psibase.127.0.0.1.sslip.io:8080/",
                    // disable dev server forcing security to the chain
                    secure: false,
                },
            },
        };
    } else {
        serverConfig = {
            ...httpServerConfig,
            proxy: {
                "/": {
                    ...httpServerConfig.proxy["/"],
                    target: "http://psibase.127.0.0.1.sslip.io:8080/",
                },
            },
        };
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
                    ...(server && {
                        server: serverConfig,
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
                                    "../../CommonSys/common/resources$1"
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
                    replacement: `http${
                        runLocalHttpsDev ? "s" : ""
                    }://psibase.127.0.0.1.sslip.io:8080/common/rpc.mjs`,
                },
            ],
        }),
    ];
};

export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    // https://vitejs.dev/config/
    return defineConfig({
        plugins: [
            tsconfigPaths(),
            svgr({ exportAsDefault: true }),
            react(),
            mdPlugin({ mode: [Mode.HTML] }),
            psibase({ serviceName: "fractal-sys", server: true, env: process.env }),
        ],
        resolve: {
            // These aliases are the second stage of translation when locating a local resource.
            // First the paths in tsconfig.json translates the import statement's path to a path on the drive.
            // Then these aliasses will replace the result.
            alias: {
                "@toolbox/components": "@toolbox/components/src",
                process: "process/browser",
            },
        },
        publicDir: "public",
    });
};