import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ensureSettings } from "./settings.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "..");

export async function main() {
  const dataDir = path.join(repoRoot, "data");
  const port = portFrom(process.env.PORT);
  await ensureSettings(dataDir);
  const app = createApp({
    dataDir,
    workflowsDir: path.join(serverRoot, "workflows"),
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") console.error(`端口 ${port} 已被占用。`);
    else console.error(err);
    process.exit(1);
  });
  console.log(`绘境后端已启动  http://127.0.0.1:${port}`);
}

function portFrom(value: string | undefined): number {
  const port = Number(value);
  if (!value || !Number.isInteger(port) || port < 1 || port > 65535) return 8741;
  return port;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && path.resolve(fileURLToPath(import.meta.url)) === entry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
