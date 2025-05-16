import { defineConfig } from "vite";
import path from "path";
// @ts-ignore
import { sveltekit } from "@sveltejs/kit/vite";
import { isoImport } from "vite-plugin-iso-import";
import svg from "@poppanator/sveltekit-svg";
import { verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        isoImport(),
        sveltekit(),
        createSharedViteConfig({
            projectDir: serviceDir,
            uiFramework: 'svelte',
            manualChunks: {
                vendor: ['svelte', '@sveltejs/kit']
            }
        }),
        createPsibaseConfig({
            service: "explorer",
            serviceDir,
            uiFramework: 'svelte',
            isServing: command === "serve",
        }),
        // @ts-ignore
        svg({
            svgoOptions: {
                multipass: true,
                plugins: [
                    {
                        name: "preset-default",
                        params: { overrides: { removeViewBox: false } },
                    },
                ],
            },
        }),
    ],
}));
