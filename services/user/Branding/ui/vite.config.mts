import path from "path";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import {
    createPsibaseConfig,
    createSharedViteConfig,
    getSharedUIPlugins,
    verifyViteCache,
} from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    return {
        plugins: [
            createSharedViteConfig({
                projectDir: serviceDir,
                additionalManualChunks: {
                    "ui-utils": [
                        "lucide-react",
                        "sonner",
                        "@dicebear/collection",
                        "@dicebear/core",
                    ],
                },
            }),
            createPsibaseConfig({
                service: "branding",
                serviceDir,
                isServing: command === "serve",
                useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true",
            }),
            wasm(),
            topLevelAwait(),
            ...getSharedUIPlugins(),
        ],
        build: {
            minify: false,
            sourcemap: false,
        },
    };
});
