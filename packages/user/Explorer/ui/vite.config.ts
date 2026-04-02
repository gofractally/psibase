import { defineConfig } from "vite";
import path from "path";
// @ts-ignore
import { sveltekit } from "@sveltejs/kit/vite";
import { isoImport } from "vite-plugin-iso-import";
import svg from "@poppanator/sveltekit-svg";
import { verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const appDirectory = path.resolve(__dirname);
verifyViteCache(appDirectory);

// https://vitejs.dev/config/
export default defineConfig((config) => ({
    plugins: [
        isoImport(),
        sveltekit(),
        createSharedViteConfig({
            uiFramework: 'svelte',
            manualChunks: {
                vendor: ['svelte', '@sveltejs/kit']
            }
        }),
        createPsibaseConfig(config, {
            appDirectory,
            uiFramework: 'svelte',
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
