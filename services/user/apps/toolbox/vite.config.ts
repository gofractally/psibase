import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import svgr from "vite-plugin-svgr";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [tsconfigPaths(), svgr({ exportAsDefault: true }), react()],
    resolve: {
        // These aliases are the second stage of translation when locating a local resource.
        // First the paths in tsconfig.json translates the import statement's path to a path on the drive.
        // Then these aliasses will replace the result.
        alias: {
            "@toolbox/components": "@toolbox/components/src",
        },
    },
});
