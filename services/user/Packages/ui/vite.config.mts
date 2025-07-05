import path from "path";
import { defineConfig } from "vite";

import {
    createPsibaseConfig,
    createSharedViteConfig,
    getSharedUIPlugins,
    verifyViteCache,
} from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);
const serviceName = "packages";

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        createSharedViteConfig({
            projectDir: serviceDir,
        }),
        createPsibaseConfig({
            service: serviceName,
            serviceDir,
            isServing: command === "serve",
            useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true",
        }),
        ...getSharedUIPlugins(),
    ],
    build: {
        minify: false,
        sourcemap: false,
    },
}));
