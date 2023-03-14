// vite.config.ts
import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "@psibase/common-lib",
            fileName: "common-lib",
        },
        rollupOptions: {
            external: ["/common/iframeResizer.contentWindow.js"],
        },
    },
    // resolve: {
    //     alias: [
    //         {
    //             find: "/common/iframeResizer.contentWindow.js",
    //             replacement: resolve(
    //                 "../common/thirdParty/src/iframeResizer.contentWindow.js"
    //             ),
    //         },
    //     ],
    // },
    plugins: [dts()],
});
