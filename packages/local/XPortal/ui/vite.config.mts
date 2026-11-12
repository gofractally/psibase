import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";

import {
    createPsibaseConfig,
    createSharedViteConfig,
    getSharedUIPlugins,
    verifyViteCache,
} from "../../../vite.shared";

const appDirectory = path.resolve(__dirname);
verifyViteCache(appDirectory);

/** Sites serves `/admin` from `/admin/index.html`. The document is the same app. */
const adminDocument = (): Plugin => ({
    name: "xportal-admin-document",
    configureServer(server) {
        server.middlewares.use((req, _res, next) => {
            const url = req.url?.split("?")[0];
            if (url === "/admin" || url === "/admin/") {
                req.url = "/index.html";
            }
            next();
        });
    },
    closeBundle() {
        const dist = path.resolve(appDirectory, "dist");
        const index = path.join(dist, "index.html");
        if (!fs.existsSync(index)) {
            throw new Error("x-portal build finished without dist/index.html");
        }
        fs.mkdirSync(path.join(dist, "admin"), { recursive: true });
        fs.copyFileSync(index, path.join(dist, "admin", "index.html"));
    },
});

export default defineConfig((config) => ({
    plugins: [
        createSharedViteConfig(),
        createPsibaseConfig(config, { appDirectory }),
        ...getSharedUIPlugins(),
        adminDocument(),
    ],
    build: {
        minify: true,
        sourcemap: false,
    },
}));
