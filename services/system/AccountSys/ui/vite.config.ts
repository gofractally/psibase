import * as fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import svgr from "vite-plugin-svgr";
import alias from "@rollup/plugin-alias";

interface HttpsConfig {
    port: number;
    keyPath: string;
    certPath: string;
}

interface HttpConfig {
    port: number;
}

interface ProxyConfig {
    hostName: string;
    httpConfig: HttpConfig;
    httpsConfig?: HttpsConfig;
}

interface Options {
    serviceName: string;
    devServerPort: number;
    proxyConfig: ProxyConfig;
}

const psibase = (options: Options, isDev?: boolean) => {
    const {
        serviceName,
        devServerPort,
        proxyConfig: {
            hostName,
            httpConfig: { port: httpPort },
            httpsConfig: { keyPath, certPath, port: httpsPort } = {},
        },
    } = options;

    if (!serviceName) throw new Error("Must have a service name");

    const proxyProtocol = options.proxyConfig.httpsConfig ? "https" : "http";
    const proxyPort = options.proxyConfig.httpsConfig ? httpsPort : httpPort;

    const serverConfig = {
        host: hostName,
        port: devServerPort,
        https: options.proxyConfig.httpsConfig
            ? {
                  key: fs.readFileSync(keyPath, "utf8"),
                  cert: fs.readFileSync(certPath, "utf8"),
              }
            : undefined,
        proxy: {
            "/": {
                bypass: (req) => {
                    const [subdomain] = (req.headers.host || "").split(".");
                    return subdomain === serviceName &&
                        req.method !== "POST" &&
                        req.headers.accept !== "application/json" &&
                        !req.url.startsWith("/common")
                        ? req.url
                        : null;
                },
                target: `${proxyProtocol}://${hostName}:${proxyPort}/`,
                // disable dev server forcing security to the chain
                secure: options.proxyConfig.httpsConfig ? false : undefined,
            },
        },
    };

    const commonPath: string = "../../../user/CommonSys";
    const buildAliases = [
        {
            find: "/common/iframeResizer.contentWindow.js",
            replacement: path.resolve(
                `${commonPath}/common/thirdParty/src/iframeResizer.contentWindow.js`,
            ),
        },
        {
            // bundle non-external (above) common files except fonts (which should only be referenced)
            find: /^\/common(?!\/(?:fonts))(.*)$/,
            replacement: path.resolve(`${commonPath}/common$1`),
        },
    ];

    if (isDev) {
        buildAliases.push({
            find: "@psibase/common-lib",
            replacement: path.resolve(`${commonPath}/common-lib/src`),
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
                                "/common/useLocalStorage.mjs",
                                "/common/common-lib.js",
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: "index.js",
                                assetFileNames: "[name][extname]",
                            },
                        },
                        // target: "es2022",
                    },
                    server: serverConfig,
                    resolve: {
                        alias: buildAliases,
                    },
                };
            },
        },
        alias({
            entries: [
                {
                    find: "common/useLocalStorage.mjs",
                    replacement: "/common/useLocalStorage.mjs",
                },
                {
                    find: "@psibase/common-lib",
                    replacement: "/common/common-lib.js",
                },
            ],
        }),
    ];
};

const options = {
    serviceName: "account-sys",
    devServerPort: 8081,
    proxyConfig: {
        hostName: "psibase.127.0.0.1.sslip.io",
        httpConfig: {
            port: 8079,
        },
        httpsConfig: {
            port: 8080,
            keyPath: "/root/certs/psibase.127.0.0.1.sslip.io+1-key.pem",
            certPath: "/root/certs/psibase.127.0.0.1.sslip.io+1.pem",
        },
    },
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        svgr({ exportAsDefault: true }),
        psibase(options, command === "serve"),
    ],
}));
