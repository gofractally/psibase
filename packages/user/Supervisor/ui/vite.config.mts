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
export default defineConfig(({ command }) => ({
    plugins: [
        createSharedViteConfig({
            projectDir: serviceDir,
        }),
        createPsibaseConfig({
            service: "supervisor",
            serviceDir: serviceDir,
            isServing: command === "serve",
            useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true",
        }),
        ...getSharedUIPlugins(),
    ],
    build: {
        target: "esnext",
        minify: true,
        sourcemap: false,
        rollupOptions: {
            external: ["hash.js", "elliptic"],
            input: {
                main: path.resolve(serviceDir, "index.html"),
                prompt: path.resolve(serviceDir, "prompt.html"),
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