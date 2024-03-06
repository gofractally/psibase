import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// NOTE: This bundles common-lib. This is easier for experiemental dev apps like this.
// Normally, an app would reference common-lib as an external resource.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["/common/iframeResizer.contentWindow.js"],
    },
  },
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@psibase\/common-lib.*$/,
        replacement: path.resolve(
          "../../../services/user/CommonSys/common/packages/common-lib/src"
        ),
      },
    ],
  },
});
