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

const appDirectory = path.resolve(__dirname);
verifyViteCache(appDirectory);

// https://vitejs.dev/config/
export default defineConfig((config) => ({
    plugins: [
        createSharedViteConfig({
            manualChunks: {
                vendor: ["react", "react-dom", "react-router-dom"],
            },
        }),
        createPsibaseConfig(config, {
            appDirectory,
            additionalAliases: [
                {
                    find: "wasm-transpiled",
                    replacement: path.resolve(
                        appDirectory,
                        "./wasm-transpiled/x_admin",
                    ),
                },
            ],
        }),
        ...getSharedUIPlugins(),
        wasm(),
        topLevelAwait(),
    ],
    build: {
        minify: true,
        sourcemap: false,
    },
}));
