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
                oauth: path.resolve(serviceDir, "oauth.html"),
            },
            output: {
                entryFileNames: "assets/[name].js",
                chunkFileNames: "assets/[name].js",
                assetFileNames: "assets/[name].[ext]",
            },
        },
    },
}));
