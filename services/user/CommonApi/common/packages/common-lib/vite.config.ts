// vite.config.ts
import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import fs from "fs";

// Ensure cache directory exists
const cacheDir = resolve(__dirname, ".vite-cache");
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "@psibase/common-lib",
            fileName: "common-lib",
        },
        minify: false,
        // Enable build cache in a project-specific directory
        cacheDir: cacheDir,
        // Enable sourcemap for better caching
        sourcemap: true,
        // Enable caching of transformed modules
        rollupOptions: {
            cache: true,
        },
    },
    plugins: [dts()],
});
