import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CLIENT_HEADER, isClientId } from "@huijing/shared";
import { checkComfy, type OpenSocket } from "./comfy.js";
import { RequestError } from "./errors.js";
import { createHistory } from "./history.js";
import { createRuns, type RunEvent } from "./runs.js";
import { createImageImageService } from "./services/image-image.js";
import { createTextImageService } from "./services/text-image.js";
import { loadSettings } from "./settings.js";

export type AppOptions = {
  dataDir: string;
  workflowsDir: string;
  fetchImpl?: typeof fetch;
  openSocket?: OpenSocket;
  now?: () => number;
};

export function createApp(options: AppOptions) {
  const history = createHistory({ dataDir: options.dataDir, now: options.now });
  void history.sweep();
  const runs = createRuns({
    dataDir: options.dataDir,
    now: options.now,
    services: [
      createTextImageService(options),
      createImageImageService(options),
    ],
    onImage: (image) => history.remember(image),
  });
  const app = new Hono();

  app.use("/api/*", noStore);
  app.onError((err, c) => {
    if (err instanceof RequestError) return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    console.error(err);
    return c.json({ error: "服务内部出错。" }, 500);
  });

  app.get("/api/health", async (c) => {
    const settings = await loadSettings(options.dataDir);
    const comfy = await checkComfy(settings.comfyBase, options.fetchImpl);
    return c.json({ ok: comfy, comfy, running: runs.running() });
  });

  app.get("/api/services", (c) => c.json({ services: runs.listServices() }));

  app.post("/api/services/:name", async (c) => {
    const clientId = clientFrom(c);
    if (!clientId) throw new RequestError(400, "缺少客户端标识。");
    const contentType = c.req.header("content-type") || "";
    const body = contentType.includes("multipart/form-data") ? await c.req.parseBody() : await readBody(c);
    const created = await runs.submit(c.req.param("name"), body, clientId);
    return c.json(created);
  });

  app.get("/api/history", async (c) => {
    const clientId = clientFrom(c);
    if (!clientId) throw new RequestError(400, "缺少客户端标识。");
    return c.json({ items: await history.list(clientId) });
  });

  app.delete("/api/history/:id", async (c) => {
    const clientId = clientFrom(c);
    if (!clientId) throw new RequestError(400, "缺少客户端标识。");
    const removed = await history.remove(clientId, c.req.param("id"));
    if (!removed) return c.json({ error: "没有这张图。" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/runs/:id", (c) => {
    const run = runs.get(c.req.param("id"));
    if (!run) return c.json({ error: "没有这次运行。" }, 404);
    return c.json(run);
  });

  app.get("/api/runs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!runs.get(id)) return c.json({ error: "没有这次运行。" }, 404);
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    return stream(c, async (output) => {
      const events = new EventQueue();
      const unsubscribe = runs.subscribe(id, (event) => events.push(event));
      output.onAbort(() => events.end());
      try {
        while (true) {
          const event = await events.next();
          if (!event) return;
          await output.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
          if (event.event === "done" || event.event === "error") return;
        }
      } catch {
        return;
      } finally {
        unsubscribe();
      }
    });
  });

  app.get("/api/runs/:id/image", async (c) => {
    const id = c.req.param("id");
    const image = runs.image(id) ?? await history.readImage(id);
    if (image) {
      return c.body(Buffer.from(image.bytes), 200, { "Content-Type": image.mediaType });
    }
    if (!runs.get(id)) return c.json({ error: "没有这次运行。" }, 404);
    return c.json({ error: "图片还没有生成。" }, 404);
  });

  app.post("/api/runs/:id/cancel", (c) => c.json(runs.cancel(c.req.param("id"))));

  app.all("/api/*", (c) => c.json({ error: "没有这个接口。" }, 404));
  return app;
}

const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};

function clientFrom(c: Context): string | null {
  const value = c.req.header(CLIENT_HEADER);
  if (!isClientId(value)) return null;
  return value.toLowerCase();
}

async function readBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RequestError(400, "请求不是 JSON。");
  }
}

class EventQueue {
  private items: Array<RunEvent | null> = [];
  private waiters: Array<(event: RunEvent | null) => void> = [];

  push(event: RunEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.items.push(event);
  }

  next(): Promise<RunEvent | null> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  end() {
    const waiter = this.waiters.shift();
    if (waiter) waiter(null);
    else this.items.push(null);
  }
}
