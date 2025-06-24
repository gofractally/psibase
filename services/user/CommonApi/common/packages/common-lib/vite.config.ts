// vite.config.ts
import { promises as fs } from "fs";
import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { viteStaticCopy } from 'vite-plugin-static-copy';

const serviceDir = path.resolve(__dirname);

console.log("auth-cookie.ts path:", path.resolve(serviceDir, "auth-cookie.ts"));

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(serviceDir, "src/index.ts"),
            name: "@psibase/common-lib",
            fileName: "common-lib",
        },
        minify: false,
        // rollupOptions: {
        //     // Include auth-cookie.ts in the build
        //     input: [
        //       path.resolve(serviceDir, "src/auth-cookie.ts")
        //     ],
        //     output: {
        //       entryFileNames: '[name].js',
        //     }
        //   }
    },
    plugins: [
        dts(),
        viteStaticCopy({
            targets: [
              { src: 'src/auth-cookie.html', dest: '.' }
            ],
        })
    ],
});