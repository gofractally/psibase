import * as path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
    // https://github.com/vitejs/vite/discussions/1736
    build: {
        lib: {
            entry: path.resolve(__dirname, "src/index.ts"),
            name: "psi-rpc",
            fileName: "rpc.js",
        },
        manifest: true,
        rollupOptions: {
            output: [
                {
                    // for compatible-with-everything es2015/es6
                    dir: "dist",
                    format: "es",
                    entryFileNames: "[name].es.js",
                },
                {
                    // for <script /> tags
                    dir: "dist",
                    format: "umd",
                    entryFileNames: "[name].umd.js",
                    globals: {
                        "psi-rpc": "PsiRpc",
                    },
                },
                {
                    // for require() format imports
                    dir: "dist",
                    format: "commonjs",
                    entryFileNames: "[name].cjs.js",
                },
            ],
            external: ["React"],
        },
    },
});
