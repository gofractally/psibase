import path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@messaging": path.resolve(__dirname, "../../messaging"),
    },
  },
  build: {
    target: "esnext",
  },
});
