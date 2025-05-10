import adapter from "@sveltejs/adapter-static";
import preprocess from "svelte-preprocess";

/** @type {import('@sveltejs/kit').Config} */
const config = {
    kit: {
        adapter: adapter({
            pages: "dist",
            assets: "dist",
            fallback: "index.html",
        }),
        alias: {
            '/common': '../../CommonApi/common',
            '@psibase/common-lib': '../../CommonApi/common/packages/common-lib/src'
        }
    },
    preprocess: preprocess({
        postcss: true,
    }),
};

export default config;
