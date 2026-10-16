import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_HEADER, type RunSnapshot } from "@huijing/shared";
import { createApp } from "../src/app.js";
import { HISTORY_TTL_MS } from "../src/history.js";
import type { OpenSocket } from "../src/comfy.js";
import { complete } from "../src/ollama.js";

const workflowsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../workflows");
const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Release = () => void;

describe("generation services", () => {
  afterEach(async () => {
    await closeFakes?.();
    closeFakes = null;
    if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
    dataDir = "";
  });

  it("fills the text-to-image workflow and returns the image", async () => {
    const started = await boot();
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨里的石桥",
      ratio: "2:3",
    });
    const snapshot = await waitFor(started.app, created.id, (run) => run.phase === "done");
    const workflow = started.workflows[0];
    expect(workflow["10"]).toMatchObject({ inputs: { prompt: "夜雨里的石桥", resolution: 1024 } });
    expect(workflow["11"]).toMatchObject({ inputs: { width: 832, height: 1248 } });
    expect(workflow["7"]).toMatchObject({ inputs: { seed: snapshot.seed } });
    expect(workflow["1"]).toMatchObject({ inputs: { unet_name: "qwen-image-2.1-UC-fp8.safetensors" } });
    expect(started.calls).toEqual(["comfy"]);
    const image = await started.app.request(`/api/runs/${created.id}/image`);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG);
  });

  it("sizes an image-to-image run from the reference picture", async () => {
    const started = await boot();
    const form = new FormData();
    form.set("text", "保持脸，换成夜雨");
    form.set("image", new File([new Uint8Array(png(100, 200))], "src.png", { type: "image/png" }));
    const response = await started.app.request("/api/services/image.image", { method: "POST", body: form, headers: clientHeaders() });
    const created = await response.json() as { id: string };
    await waitFor(started.app, created.id, (run) => run.phase === "done");
    const workflow = started.workflows[0];
    expect(started.calls).toEqual(["upload", "comfy"]);
    expect(workflow["10"]).toMatchObject({ inputs: { prompt: "保持脸，换成夜雨", resolution: 1024 } });
    expect(workflow["13"]).toMatchObject({ inputs: { width: 736, height: 1440 } });
    expect(workflow["12"]).toMatchObject({ inputs: { image: "ref.png" } });
  });

  it("uses the requested clarity for width, height, and resolution", async () => {
    const started = await boot();
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨里的石桥",
      ratio: "16:9",
      scale: "2k",
    });
    await waitFor(started.app, created.id, (run) => run.phase === "done");
    expect(started.workflows[0]["10"]).toMatchObject({ inputs: { resolution: 2048 } });
    expect(started.workflows[0]["11"]).toMatchObject({ inputs: { width: 2720, height: 1536 } });

    const form = new FormData();
    form.set("text", "保持脸，换成夜雨");
    form.set("scale", "1.5k");
    form.set("image", new File([new Uint8Array(png(100, 200))], "src.png", { type: "image/png" }));
    const response = await started.app.request("/api/services/image.image", { method: "POST", body: form, headers: clientHeaders() });
    const imageRun = await response.json() as { id: string };
    await waitFor(started.app, imageRun.id, (run) => run.phase === "done");
    expect(started.workflows[1]["10"]).toMatchObject({ inputs: { resolution: 1536 } });
    expect(started.workflows[1]["13"]).toMatchObject({ inputs: { width: 1088, height: 2176 } });
  });

  it("rejects an unknown clarity", async () => {
    const started = await boot();
    const response = await started.app.request("/api/services/text.image", {
      method: "POST",
      headers: clientHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ text: "夜雨", ratio: "1:1", scale: "4k" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "清晰度不在规定的选项里。" });
  });

  it("rejects a missing reference image", async () => {
    const started = await boot();
    const form = new FormData();
    form.set("text", "夜雨");
    const response = await started.app.request("/api/services/image.image", { method: "POST", body: form, headers: clientHeaders() });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "请上传一张参考图。" });
    expect(started.calls).toEqual([]);
  });

  it("streams sampling progress and cancels the active image", async () => {
    const started = await boot();
    const release = started.holdComfy();
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨里的石桥",
      ratio: "1:1",
    });
    await waitFor(started.app, created.id, (run) => run.phase === "sampling");
    const pending = readEvents(started.app, created.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    const events = await pending;
    expect(events.some((event) => event.event === "progress" && event.data.phase === "sampling")).toBe(true);
    expect(events.at(-1)?.event).toBe("done");

    const held = started.holdComfy();
    const before = started.calls.filter((call) => call === "comfy").length;
    const second = await postJson(started.app, "/api/services/text.image", {
      text: "另一张",
      ratio: "1:1",
    });
    await waitFor(started.app, second.id, () => started.calls.filter((call) => call === "comfy").length > before);
    const cancelled = await started.app.request(`/api/runs/${second.id}/cancel`, { method: "POST" });
    expect((await cancelled.json()).phase).toBe("cancelled");
    await waitFor(started.app, second.id, () => started.interrupts.count === 1);
    held();
  });

  it("rejects a public Comfy address before submitting", async () => {
    const started = await boot();
    await fs.writeFile(path.join(dataDir, "settings.json"), JSON.stringify({
      ollamaBase: "http://127.0.0.1:9",
      comfyBase: "http://8.8.8.8:8188",
      model: "qwen3.8t",
    }));
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨",
      ratio: "1:1",
    });
    const failed = await waitFor(started.app, created.id, (run) => run.phase === "failed");
    expect(failed.error).toMatch(/局域网/);
    expect(started.calls).not.toContain("comfy");
  });
});

describe("history", () => {
  it("keeps one browser's image away from another", async () => {
    const started = await boot();
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨里的石桥",
      ratio: "1:1",
    }, CLIENT_A);
    await waitFor(started.app, created.id, (run) => run.phase === "done");

    const own = await historyItems(started.app, CLIENT_A);
    const other = await historyItems(started.app, CLIENT_B);
    expect(own.map((item) => item.id)).toEqual([created.id]);
    expect(own[0]).toMatchObject({ prompt: "夜雨里的石桥", service: "text.image", image: `/api/runs/${created.id}/image` });
    expect(other).toEqual([]);

    const removed = await started.app.request(`/api/history/${created.id}`, {
      method: "DELETE",
      headers: clientHeaders(undefined, CLIENT_B),
    });
    expect(removed.status).toBe(404);
    expect((await historyItems(started.app, CLIENT_A)).map((item) => item.id)).toEqual([created.id]);
    await fs.access(path.join(dataDir, "outputs", `${created.id}.png`));
  });

  it("drops the oldest file after the twelfth image", async () => {
    let clock = 1_000_000;
    const started = await boot({ now: () => clock });
    const ids: string[] = [];
    for (let index = 0; index < 13; index += 1) {
      clock += 1000;
      const created = await postJson(started.app, "/api/services/text.image", {
        text: `第${index}张`,
        ratio: "1:1",
      });
      await waitFor(started.app, created.id, (run) => run.phase === "done");
      ids.push(created.id);
    }
    const items = await historyItems(started.app, CLIENT_A);
    expect(items.map((item) => item.id)).toEqual([...ids].reverse().slice(0, 12));
    await expect(fs.access(path.join(dataDir, "outputs", `${ids[0]}.png`))).rejects.toThrow();
    await fs.access(path.join(dataDir, "outputs", `${ids[12]}.png`));
  });

  it("removes an image once it is seven days old, even for a browser that stays away", async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "huijing-"));
    const client = "44444444-4444-4444-8444-444444444444";
    const id = "55555555-5555-4555-8555-555555555555";
    await fs.mkdir(path.join(dataDir, "history"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "outputs"), { recursive: true });
    await fs.writeFile(path.join(dataDir, "history", `${client}.json`), JSON.stringify([{
      id,
      createdAt: 0,
      prompt: "旧图",
      service: "text.image",
      mediaType: "image/png",
    }]));
    const image = path.join(dataDir, "outputs", `${id}.png`);
    await fs.writeFile(image, PNG);
    await boot({ reuseData: true, now: () => HISTORY_TTL_MS });
    await waitUntilGone(image);
    expect(JSON.parse(await fs.readFile(path.join(dataDir, "history", `${client}.json`), "utf8"))).toEqual([]);
  });

  it("rejects a submit without a client id", async () => {
    const started = await boot();
    const missing = await started.app.request("/api/services/text.image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "夜雨", ratio: "1:1" }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "缺少客户端标识。" });
    const invalid = await started.app.request("/api/services/text.image", {
      method: "POST",
      headers: clientHeaders({ "content-type": "application/json" }, "not-a-uuid"),
      body: JSON.stringify({ text: "夜雨", ratio: "1:1" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "缺少客户端标识。" });
  });

  it("serves an unexpired image from disk after the run leaves memory", async () => {
    const started = await boot();
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨里的石桥",
      ratio: "1:1",
    });
    await waitFor(started.app, created.id, (run) => run.phase === "done");
    const restarted = createApp({ dataDir, workflowsDir });
    expect((await restarted.request(`/api/runs/${created.id}`)).status).toBe(404);
    const image = await restarted.request(`/api/runs/${created.id}/image`);
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG);
  });

  it("leaves failed and cancelled runs out of history", async () => {
    const started = await boot();
    const release = started.holdComfy();
    const created = await postJson(started.app, "/api/services/text.image", {
      text: "夜雨里的石桥",
      ratio: "1:1",
    });
    await waitFor(started.app, created.id, (run) => run.phase === "sampling");
    const cancelled = await started.app.request(`/api/runs/${created.id}/cancel`, { method: "POST" });
    expect((await cancelled.json()).phase).toBe("cancelled");
    release();
    await waitFor(started.app, created.id, (run) => run.phase === "cancelled");
    expect(await historyItems(started.app, CLIENT_A)).toEqual([]);
  });
});

describe("ollama interface", () => {
  it("returns the completed text", async () => {
    const server = http.createServer(async (req, res) => {
      if (req.url === "/api/chat") {
        await readRaw(req);
        json(res, 200, { message: { content: "雨夜石桥。" } });
        return;
      }
      json(res, 404, {});
    });
    const port = await listen(server);
    try {
      const text = await complete({
        base: `http://127.0.0.1:${port}`,
        model: "qwen3.8t",
        messages: [{ role: "user", content: "写一句" }],
        signal: AbortSignal.timeout(2_000),
      });
      expect(text).toBe("雨夜石桥。");
      await expect(complete({
        base: "http://8.8.8.8:11434",
        model: "qwen3.8t",
        messages: [{ role: "user", content: "写一句" }],
        signal: AbortSignal.timeout(2_000),
      })).rejects.toThrow(/局域网/);
    } finally {
      await close(server);
    }
  });
});

async function boot(options: { now?: () => number; reuseData?: boolean } = {}) {
  const backend = await startComfy();
  if (!options.reuseData || !dataDir) {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "huijing-"));
  }
  await fs.writeFile(path.join(dataDir, "settings.json"), JSON.stringify({
    ollamaBase: "http://127.0.0.1:9",
    comfyBase: backend.base,
    model: "qwen3.8t",
  }));
  closeFakes = backend.close;
  return {
    app: createApp({ dataDir, workflowsDir, openSocket: backend.openSocket, now: options.now }),
    calls: backend.calls,
    workflows: backend.workflows,
    interrupts: backend.interrupts,
    holdComfy: backend.holdComfy,
  };
}

let dataDir = "";
let closeFakes: (() => Promise<void>) | null = null;

async function startComfy() {
  const calls: string[] = [];
  const workflows: Array<Record<string, unknown>> = [];
  const interrupts = { count: 0 };
  const waits: Array<Promise<void>> = [];
  let emit: ((message: unknown) => void) | null = null;
  let seq = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/system_stats") return json(res, 200, {});
    if (url.pathname === "/upload/image" && req.method === "POST") {
      await readRaw(req);
      calls.push("upload");
      return json(res, 200, { name: "ref.png", subfolder: "", type: "input" });
    }
    if (url.pathname === "/prompt" && req.method === "POST") {
      calls.push("comfy");
      const payload = await readJsonBody(req) as { prompt?: Record<string, unknown> };
      if (payload.prompt) workflows.push(payload.prompt);
      const id = `p${seq += 1}`;
      const wait = waits.shift();
      json(res, 200, { prompt_id: id });
      const send = () => {
        emit?.({ type: "progress", data: { value: 1, max: 4, prompt_id: id } });
        emit?.({ type: "execution_success", data: { prompt_id: id } });
      };
      if (wait) void wait.then(send);
      else queueMicrotask(send);
      return;
    }
    if (url.pathname.startsWith("/history/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() || "");
      return json(res, 200, {
        [id]: { outputs: { "8": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } } },
      });
    }
    if (url.pathname === "/view") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
      return;
    }
    if (url.pathname === "/interrupt") {
      interrupts.count += 1;
      res.writeHead(200);
      res.end();
      return;
    }
    json(res, 404, {});
  });
  const port = await listen(server);
  const openSocket: OpenSocket = async (_url, onMessage) => {
    emit = onMessage;
    return { close() { emit = null; } };
  };
  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    workflows,
    interrupts,
    openSocket,
    holdComfy(): Release {
      let release: Release = () => undefined;
      waits.push(new Promise((resolve) => { release = resolve; }));
      return release;
    },
    close: () => close(server),
  };
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[11] = 13;
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function clientHeaders(headers?: HeadersInit, client = CLIENT_A): Headers {
  const next = new Headers(headers);
  next.set(CLIENT_HEADER, client);
  return next;
}

async function historyItems(app: ReturnType<typeof createApp>, client: string) {
  const response = await app.request("/api/history", { headers: clientHeaders(undefined, client) });
  expect(response.status).toBe(200);
  const body = await response.json() as { items: Array<{ id: string; prompt: string; service: string; image: string }> };
  return body.items;
}

async function waitUntilGone(file: string) {
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    try {
      await fs.access(file);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`file stayed: ${file}`);
}

async function postJson(app: ReturnType<typeof createApp>, url: string, payload: unknown, client = CLIENT_A) {
  const response = await app.request(url, {
    method: "POST",
    headers: clientHeaders({ "content-type": "application/json" }, client),
    body: JSON.stringify(payload),
  });
  const body = await response.json() as { id?: string; error?: string };
  if (!response.ok) throw new Error(body.error || String(response.status));
  return { id: body.id || "" };
}

async function waitFor(app: ReturnType<typeof createApp>, id: string, done: (run: RunSnapshot) => boolean) {
  const started = Date.now();
  let latest: RunSnapshot | null = null;
  while (Date.now() - started < 3_000) {
    latest = await (await app.request(`/api/runs/${id}`)).json() as RunSnapshot;
    if (done(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out at ${latest?.phase}: ${latest?.error || ""}`);
}

async function readEvents(app: ReturnType<typeof createApp>, id: string) {
  const response = await app.request(`/api/runs/${id}/events`);
  const text = await response.text();
  return text.split("\n\n").flatMap((block) => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return [];
    return [{ event, data: JSON.parse(data) as { phase?: string } }];
  });
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readRaw(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const raw = (await readRaw(req)).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
