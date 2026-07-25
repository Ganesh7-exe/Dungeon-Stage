import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        stage: resolve(__dirname, "stage.html"),
      },
    },
  },
  server: {
    // Keep Control + Stage on the same origin for postMessage/BroadcastChannel.
    port: 5173,
    strictPort: true,
  },
});
