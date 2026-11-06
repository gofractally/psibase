import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@shared": path.resolve(__dirname, "../../../shared-ui"),
        },
    },
    test: {
        include: ["src/**/*.test.ts"],
    },
});
