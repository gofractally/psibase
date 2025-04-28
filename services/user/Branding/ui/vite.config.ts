import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";
import { createSkipUnchangedBuildPlugin, verifyViteCache, createPsibaseConfig, buildAlias, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    return {
        plugins: [
            react(),
            createSharedViteConfig({
                projectDir: serviceDir,
                // framework: 'react',
                additionalManualChunks: {
                    // Radix UI components
                    'radix-ui': [
                        '@radix-ui/react-dropdown-menu',
                        '@radix-ui/react-label',
                        '@radix-ui/react-separator',
                        '@radix-ui/react-slot',
                        '@radix-ui/react-tabs',
                        '@radix-ui/react-tooltip'
                    ],
                    // Animation libraries
                    animation: ['framer-motion'],
                    // UI utilities
                    'ui-utils': [
                        'class-variance-authority',
                        'clsx',
                        'tailwind-merge',
                        'tailwindcss-animate',
                        'lucide-react'
                    ],
                }
            }),
            ...createPsibaseConfig({
                service: "branding",
                serviceDir,
                isServing: command === "serve",
                useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true"
            }),
            wasm(),
            topLevelAwait(),
            tsconfigPaths(),
            createSkipUnchangedBuildPlugin(path.dirname(__filename))
        ],
    };
});
