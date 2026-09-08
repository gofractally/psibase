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
        minify: true,
        sourcemap: false,
    },
}));
