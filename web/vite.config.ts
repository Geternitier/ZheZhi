import { defineConfig } from "vite";

const api = process.env.HUIJING_API || "http://127.0.0.1:8741";
const port = Number(process.env.WEB_PORT);

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number.isInteger(port) && port > 0 ? port : 18473,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": api,
    },
  },
});
