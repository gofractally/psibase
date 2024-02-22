// vite.config.js
import path from "path";
import { defineConfig } from "vite";

// TODO: This currently bundles common-lib. This is easier while we're developing. It should ultimately reference common-lib as an external resource.
export default defineConfig({
    resolve: {
        alias: [
            {
                find: "/common/iframeResizer.contentWindow.js",
                replacement: path.resolve(
                    "../../thirdParty/src/iframeResizer.contentWindow.js"
                )
            },
            {
                find: /^@psibase\/common-lib.*$/,
                replacement: path.resolve("../common-lib/src")
            }
        ]
    }
});
