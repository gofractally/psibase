import path from "path";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import {
    createPsibaseConfig,
    createSharedViteConfig,
    getSharedUIPlugins,
    verifyViteCache,
} from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        createSharedViteConfig({
            projectDir: serviceDir,
            manualChunks: {
                vendor: ["react", "react-dom", "react-router-dom"],
            },
        }),
        createPsibaseConfig({
            service: "x-admin",
            serviceDir: serviceDir,
            isServing: command === "serve",
            useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true",
            additionalAliases: [
                {
                    find: "wasm-transpiled",
                    replacement: path.resolve(
                        serviceDir,
                        "./wasm-transpiled/x_admin",
                    ),
                },
            ],
            additionalProxies: {
                "^/ws/.*": {
                    target: "ws://localhost:8080/",
                    ws: true,
                    rewrite: (path) => path.replace(/^\/ws/, ""),
                    timeout: 10000,
                },
            },
            additionalProxyBypassConditions: [(req) => req.method !== "PUT"],
        }),
        wasm(),
        topLevelAwait(),
        ...getSharedUIPlugins(),
    ],
    build: {
        minify: false,
        sourcemap: false,
    },
}));
