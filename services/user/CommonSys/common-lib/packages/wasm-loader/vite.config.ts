// vite.config.js
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@messaging": path.resolve(__dirname, "../../../common/messaging"),
    },
  },
});
