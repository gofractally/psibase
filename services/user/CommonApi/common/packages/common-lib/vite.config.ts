// vite.config.ts
import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const serviceDir = path.resolve(__dirname);

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(serviceDir, "src/index.ts"),
            name: "@psibase/common-lib",
            fileName: "common-lib",
        },
        minify: true,
        sourcemap: false,
    },
    plugins: [
        dts(),
    ],
});