import path from "path";
import { defineConfig } from "vite";

// A separate entry avoids pulling browser-only common-lib initialization into
// Node consumers which only need action-name encoding and decoding.
export default defineConfig({
    build: {
        target: "es2020",
        emptyOutDir: false,
        minify: true,
        sourcemap: false,
        lib: {
            entry: path.resolve(__dirname, "src/action-name.ts"),
            formats: ["es", "cjs"],
            fileName: (format) =>
                format === "es" ? "action-name.js" : "action-name.cjs",
        },
    },
});
