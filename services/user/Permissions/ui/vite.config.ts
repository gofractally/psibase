import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import * as fs from "fs";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";
import { createSkipUnchangedBuildPlugin, verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        createSharedViteConfig({
            projectDir: serviceDir,
            // framework: 'react',
        }),
        ...createPsibaseConfig({
            service: "permissions",
            serviceDir,
            isServing: command === "serve",
            useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true"
        }),
        wasm(),
        topLevelAwait(),
        tsconfigPaths(),
        createSkipUnchangedBuildPlugin(serviceDir)
    ],
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(serviceDir, "index.html"),
                perms: path.resolve(serviceDir, "permissions.html"),
            },
        },
    },
}));
