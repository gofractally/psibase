import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// NOTE: This bundles common-lib. This is easier for experiemental dev apps like this.
// Normally, an app would reference common-lib as an external resource.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "/common/iframeResizer.contentWindow.js",
        replacement: path.resolve(
          "../../CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
        ),
      },
      {
        find: /^@psibase\/common-lib.*$/,
        replacement: path.resolve(
          "../../CommonSys/common/packages/common-lib/src"
        ),
      },
    ],
  },
});
