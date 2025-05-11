import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);
const wasmDir = path.resolve(__dirname, "./wasm");

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        react({
            babel: {
                parserOpts: {
                    plugins: ["decorators-legacy"],
                },
            },
        }),
        createSharedViteConfig({
            projectDir: serviceDir,
            manualChunks: {
                vendor: ['react', 'react-dom', 'react-router-dom']
            },
        }),
        ...createPsibaseConfig({
            service: "x-admin",
            serviceDir,
            isServing: command === "serve",
            additionalAliases: [
                {
                    find: "wasm-transpiled",
                    replacement: path.resolve(serviceDir, "./wasm-transpiled/x_admin")
                }
            ],
            additionalProxies: {
                "^/ws/.*": {
                    target: "ws://localhost:8080/",
                    ws: true,
                    rewrite: (path) => path.replace(/^\/ws/, ""),
                    timeout: 10000,
                },
            },
            additionalProxyBypassConditions: [ (req) => req.method !== "PUT" ]
        }),
        wasm(),
        topLevelAwait(),
        [{
            resolve: {
                alias: {
                    "@/lib": path.resolve(serviceDir, "./src/lib"),
                    "@/components": path.resolve(serviceDir, "./src/components"),
                    "wasm-transpiled": path.resolve(
                        serviceDir,
                        "./wasm-transpiled/x_admin"
                    ),
                },
            },
        }],
    ],
}));
