// vite.config.ts
import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { createSharedViteConfig, verifyViteCache } from "../../../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(serviceDir, "src/index.ts"),
            name: "@psibase/common-lib",
            fileName: "common-lib",
        },
        minify: false,
    },
    plugins: [
        dts()
    ],
});


