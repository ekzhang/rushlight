import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 6480,
    proxy: {
      "/ws": {
        target: "ws://localhost:6471",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
