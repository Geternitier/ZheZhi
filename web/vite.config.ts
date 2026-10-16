import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 18473,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": "http://127.0.0.1:8741",
    },
  },
});
