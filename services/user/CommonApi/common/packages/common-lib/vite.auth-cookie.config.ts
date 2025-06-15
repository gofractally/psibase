import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        "auth-cookie": path.resolve(__dirname, "src/auth-cookie.ts"),
      },
      output: {
        entryFileNames: "auth-cookie.js",
      }
    },
    outDir: "dist",
    minify: false,
    emptyOutDir: false,
    target: "esnext",
  }
}); 