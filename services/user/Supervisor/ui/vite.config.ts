import path from "path";
import { defineConfig } from "vite";

// TODO: This currently bundles common-lib. This is easier while we're developing. It should ultimately reference common-lib as an external resource.
export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@psibase\/common-lib.*$/,
                replacement: path.resolve(
                    "../../CommonApi/common/packages/common-lib/src",
                ),
            },
        ],
    },
    build: {
        target: "esnext",
        minify: false,
    },
});
