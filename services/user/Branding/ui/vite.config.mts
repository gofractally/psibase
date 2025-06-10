import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import tsconfigPaths from "vite-tsconfig-paths";

import {
    createPsibaseConfig,
    createSharedViteConfig,
    verifyViteCache,
} from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    return {
        plugins: [
            react(),
            createSharedViteConfig({
                projectDir: serviceDir,
                additionalManualChunks: {
                    // Radix UI components
                    "radix-ui": [
                        "@radix-ui/react-avatar",
                        "@radix-ui/react-dropdown-menu",
                        "@radix-ui/react-label",
                        "@radix-ui/react-slot",
                    ],
                    // Animation libraries
                    animation: ["framer-motion"],
                    // UI utilities
                    "ui-utils": [
                        "class-variance-authority",
                        "clsx",
                        "tailwind-merge",
                        "lucide-react",
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
            tsconfigPaths(),
            tailwindcss(),
        ],
        build: {
            minify: false,
            sourcemap: false,
        },
    };
});
