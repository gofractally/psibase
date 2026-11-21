import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
    resolve: {
        alias: { "@psibase/common-lib": "/common/common-lib.js" },
        dedupe: ["react", "react-dom", "elliptic", "hash.js"],
    },
    build: {
        target: "es2022",
        outDir: "dist",
        rollupOptions: { external: ["/common/common-lib.js"] },
    },
    server: { fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] } },
});
