import path, { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createSkipUnchangedBuildPlugin } from "../../../vite.shared";

// TODO: This currently bundles common-lib. This is easier while we're developing. It should ultimately reference common-lib as an external resource.
export default defineConfig({
    plugins: [
        react(),createSkipUnchangedBuildPlugin(__dirname)
    ],
    resolve: {
        alias: [
            {
                find: /^@psibase\/common-lib.*$/,
                replacement: path.resolve(
                    "../../CommonApi/common/packages/common-lib/src",
                ),
            },
        ],
    },
    build: {
        // Enable build cache in a project-specific directory
        cacheDir: path.resolve(__dirname, ".vite-cache"),
        // Enable sourcemap for better caching
        sourcemap: true,
        target: "esnext",
        minify: false,
        rollupOptions: {
            external: ["hash.js", "elliptic"],
            input: {
                main: resolve(__dirname, "index.html"),
                oauth: resolve(__dirname, "oauth.html"),
            },
            output: {
                entryFileNames: "assets/[name].js",
                chunkFileNames: "assets/[name].js",
                assetFileNames: "assets/[name].[ext]",
                // This ensures oauth.html is output at the root level
                dir: "dist"
            }
        }
    },
});
