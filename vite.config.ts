import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 7680,
    proxy: {
      "/ws": {
        target: "ws://localhost:7671",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
