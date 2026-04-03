import path from "path";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

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
        svgr(),
    ],
    build: {
        minify: true,
        sourcemap: false,
    },
}));
