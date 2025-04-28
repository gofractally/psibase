import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createSkipUnchangedBuildPlugin, verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// TODO: This currently bundles common-lib. This is easier while we're developing. It should ultimately reference common-lib as an external resource.
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        createSharedViteConfig({
            projectDir: serviceDir,
            // framework: 'react',
        }),
        ...createPsibaseConfig({
            service: "supervisor",
            serviceDir,
            isServing: command === "serve"
        }),
        createSkipUnchangedBuildPlugin(serviceDir)
    ],
    build: {
        target: "esnext",
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
            }
        }
    },
}));
