import path from "path";
import { defineConfig } from "vite";

import {
    createPsibaseConfig,
    createSharedViteConfig,
    getSharedUIPlugins,
    verifyViteCache,
} from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig((config) => ({
    plugins: [
        createSharedViteConfig({
            projectDir: serviceDir,
            manualChunks: {
                vendor: ["react", "react-dom", "react-router-dom"],
            },
        }),
        createPsibaseConfig(config, {
            service: "fractals",
            serviceDir: serviceDir,
        }),
        ...getSharedUIPlugins(),
    ],
    build: {
        minify: true,
        sourcemap: false,
    },
}));
