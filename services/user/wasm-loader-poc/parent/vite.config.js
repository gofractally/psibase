import { defineConfig } from "vite";

// Configuration for building the main application
export default defineConfig({
  // Main app specific configuration...
  build: {
    outDir: "dist",
    // Other options for your main app build...
    emptyOutDir: false, // Clears the output directory on build
  },
  preview: {
    port: 3000,
  },
});
