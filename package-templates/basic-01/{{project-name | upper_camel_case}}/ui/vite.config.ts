import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";
import { createSharedViteConfig, createPsibaseConfig, verifyViteCache } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);
const serviceName = "{{project-name}}";

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        createSharedViteConfig({
                projectDir: serviceDir,
                additionalManualChunks: {},
            }),
        createPsibaseConfig({
            service: serviceName,
            serviceDir,
            isServing: command === "serve",
            useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true"
        }),
        wasm(),
        topLevelAwait(),
        tsconfigPaths(),
    ],
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "index.html"),
                perms: path.resolve(__dirname, "permissions.html"),
            },
        },
    },
}));
