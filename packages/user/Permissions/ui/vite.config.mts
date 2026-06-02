import path from "path";
import { defineConfig } from "vite";

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
        createPsibaseConfig(config, { appDirectory }),
        ...getSharedUIPlugins(),
    ],
    build: {
        minify: true,
        sourcemap: false,
        rollupOptions: {
            input: {
                main: path.resolve(appDirectory, "index.html"),
                permissions: path.resolve(
                    appDirectory,
                    "plugin/web/prompt/permissions/index.html",
                ),
            },
        },
    },
}));
