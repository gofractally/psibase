import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: ["/common/iframeResizer.contentWindow.js"],
    },
  },
  resolve: {
    alias: [
      {
        find: /^@psibase\/common-lib.*$/,
        replacement: path.resolve(
          "../../CommonSys/common/packages/common-lib/src"
        ),
      },
    ],
  },
});
