import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 6480,
    proxy: {
      "/doc": "http://localhost:6471",
    },
  },
});
