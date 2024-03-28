// vite.config.ts
import { resolve } from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "@psibase/supervisor-lib",
            fileName: "supervisor-lib",
        },
    },
    resolve: {
        alias: [
            {
                find: /^@psibase\/common-lib.*$/,
                replacement: resolve("../../CommonSys/common/packages/common-lib/src"),
            },
        ],
    },
});
