import path from "path";
import { defineConfig } from "vite";

// TODO: Reference commmon-lib as external resource instead of bundling it
export default defineConfig({
    resolve: {
        alias: [
            {
                find: "/common/iframeResizer.contentWindow.js",
                replacement: path.resolve(
                    "../../CommonSys/common/thirdParty/src/iframeResizer.contentWindow.js"
                )
            },
            {
                find: /^@psibase\/common-lib.*$/,
                replacement: path.resolve(
                    "../../CommonSys/common/packages/common-lib/src"
                )
            }
        ]
    },
    build: {
        target: "esnext"
    }
});
