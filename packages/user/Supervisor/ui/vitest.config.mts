import path from "path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "src"),
            "@psibase/common-lib": path.resolve(
                import.meta.dirname,
                "../../CommonApi/common/packages/common-lib/src",
            ),
        },
    },
    test: {
        environment: "happy-dom",
        include: ["src/**/*.test.ts"],
        setupFiles: ["src/test/setup.ts"],
    },
});
