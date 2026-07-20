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
        createSharedViteConfig(),
        createPsibaseConfig(config, { appDirectory }),
        ...getSharedUIPlugins(),
    ],
    build: {
        target: "esnext",
        minify: true,
        sourcemap: false,
        rollupOptions: {
            external: ["hash.js", "elliptic"],
            input: {
                main: path.resolve(appDirectory, "index.html"),
                prompt: path.resolve(appDirectory, "prompt.html"),
            },
            output: {
                entryFileNames: "assets/[name].js",
                chunkFileNames: "assets/[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "prompt.html") {
                        return "prompt.html";
                    }
                    return "assets/[name].[ext]";
                },
            },
        },
    },
}));
