import { Cancelled, RequestError, isCancelled } from "./errors.js";
import { privateOrigin, wsOrigin } from "./upstream.js";

const TIMEOUT_MS = 300_000;

export type SocketHandle = {
  close: () => void;
};

export type OpenSocket = (
  url: string,
  onMessage: (message: unknown) => void,
  onClose: () => void,
) => Promise<SocketHandle>;

export async function generateImage(options: {
  base: string;
  workflow: Record<string, unknown>;
  signal: AbortSignal;
  onProgress: (step: number, total: number) => void;
  openSocket?: OpenSocket;
  fetchImpl?: typeof fetch;
}): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const origin = privateOrigin(options.base);
  const fetchImpl = options.fetchImpl ?? fetch;
  const openSocket = options.openSocket ?? openWebSocket;
  const clientId = crypto.randomUUID();
  let started = false;
  const onAbort = () => {
    if (!started) return;
    fetchImpl(new URL("/interrupt", origin), { method: "POST" }).catch(() => undefined);
  };
  options.signal.addEventListener("abort", onAbort, { once: true });

  let socket: SocketHandle | null = null;
  try {
    const messages = waitForRun(options.signal, options.onProgress);
    socket = await openSocket(
      new URL(`/ws?clientId=${clientId}`, wsOrigin(origin)).href,
      messages.push,
      () => messages.closed(),
    );
    started = true;
    const promptId = await submitPrompt(origin, options.workflow, clientId, options.signal, fetchImpl);
    if (options.signal.aborted) throw new Cancelled();
    messages.expect(promptId);
    await messages.done;
    const image = await loadOutput(origin, promptId, options.signal, fetchImpl);
    return image;
  } catch (err) {
    if (isCancelled(err, options.signal)) throw new Cancelled();
    if (err instanceof RequestError || err instanceof Cancelled) throw err;
    if (isTimeout(err)) throw new RequestError(504, "等了太久还没有出完图。");
    throw new RequestError(502, "连不上 ComfyUI。请确认本机服务已启动。");
  } finally {
    options.signal.removeEventListener("abort", onAbort);
    socket?.close();
  }
}

export async function uploadImage(options: {
  base: string;
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const origin = privateOrigin(options.base);
  const fetchImpl = options.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(options.bytes)]), options.filename);
  form.append("overwrite", "true");
  let response: Response;
  try {
    response = await fetchImpl(new URL("/upload/image", origin), {
      method: "POST",
      body: form,
      signal: options.signal,
    });
  } catch (err) {
    if (isCancelled(err, options.signal)) throw new Cancelled();
    throw new RequestError(502, "连不上 ComfyUI。请确认本机服务已启动。");
  }
  const data = await readJson(response);
  if (!response.ok || typeof data.name !== "string" || !data.name) {
    throw new RequestError(502, "参考图没有被 ComfyUI 接受。");
  }
  const subfolder = typeof data.subfolder === "string" ? data.subfolder : "";
  return subfolder ? `${subfolder}/${data.name}` : data.name;
}

export async function checkComfy(base: string, fetchImpl?: typeof fetch): Promise<boolean> {
  try {
    const origin = privateOrigin(base);
    const response = await (fetchImpl ?? fetch)(new URL("/system_stats", origin), {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const openWebSocket: OpenSocket = (url, onMessage, onClose) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new RequestError(502, "连不上 ComfyUI。请确认本机服务已启动。"));
    }, 8_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({ close: () => ws.close() });
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new RequestError(502, "连不上 ComfyUI。请确认本机服务已启动。"));
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // 预览帧和无法解析的消息不参与进度。
      }
    });
    ws.addEventListener("close", () => onClose());
  });

function waitForRun(signal: AbortSignal, onProgress: (step: number, total: number) => void) {
  let expectId = "";
  let settled = false;
  let resolveDone: () => void = () => undefined;
  let rejectDone: (err: unknown) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => undefined);
  const timer = setTimeout(() => finish(new RequestError(504, "等了太久还没有出完图。")), TIMEOUT_MS);
  const onAbort = () => finish(new Cancelled());
  signal.addEventListener("abort", onAbort, { once: true });

  function finish(err?: unknown) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (err) rejectDone(err);
    else resolveDone();
  }

  const buffered: unknown[] = [];
  let ready = false;

  function handle(message: unknown) {
    if (settled || !message || typeof message !== "object") return;
    const record = message as { type?: unknown; data?: unknown };
    const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
    const promptId = typeof data.prompt_id === "string" ? data.prompt_id : "";
    if (promptId && promptId !== expectId) return;
    if (record.type === "progress") {
      const step = numberValue(data.value);
      const total = numberValue(data.max);
      if (step !== null && total !== null) onProgress(step, total);
    }
    if (record.type === "execution_error") {
      const detail = typeof data.exception_message === "string" ? data.exception_message.trim().slice(0, 120) : "";
      finish(new RequestError(502, detail ? `出图失败：${detail}` : "出图失败。"));
    }
    if (record.type === "execution_interrupted") finish(new Cancelled());
    if (record.type === "execution_success") finish();
    if (record.type === "executing" && data.node == null && promptId) finish();
  }

  return {
    done,
    expect(promptId: string) {
      expectId = promptId;
      ready = true;
      for (const message of buffered) handle(message);
      buffered.length = 0;
    },
    push(message: unknown) {
      if (!ready) {
        buffered.push(message);
        return;
      }
      handle(message);
    },
    closed() {
      finish(new RequestError(502, "ComfyUI 中断了连接。"));
    },
  };
}

async function submitPrompt(
  origin: string,
  workflow: Record<string, unknown>,
  clientId: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(new URL("/prompt", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal,
    });
  } catch (err) {
    if (isCancelled(err, signal)) throw new Cancelled();
    throw new RequestError(502, "连不上 ComfyUI。请确认本机服务已启动。");
  }
  const data = await readJson(response);
  if (!response.ok || data.error) {
    throw new RequestError(502, "工作流没有被 ComfyUI 接受。");
  }
  const promptId = typeof data.prompt_id === "string" ? data.prompt_id : "";
  if (!promptId) throw new RequestError(502, "工作流没有被 ComfyUI 接受。");
  return promptId;
}

async function loadOutput(
  origin: string,
  promptId: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const image = await findImage(origin, promptId, signal, fetchImpl);
  const view = new URL("/view", origin);
  view.searchParams.set("filename", image.filename);
  view.searchParams.set("subfolder", image.subfolder);
  view.searchParams.set("type", image.type);
  const response = await fetchImpl(view, { signal });
  if (!response.ok) throw new RequestError(502, "ComfyUI 没有返回图片。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new RequestError(502, "ComfyUI 没有返回图片。");
  const mediaType = response.headers.get("content-type")?.split(";")[0].trim() || mediaTypeFromName(image.filename);
  return { bytes, mediaType };
}

async function findImage(
  origin: string,
  promptId: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<{ filename: string; subfolder: string; type: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetchImpl(new URL(`/history/${promptId}`, origin), { signal });
    if (response.ok) {
      const data = await readJson(response);
      const found = firstImage(data[promptId]);
      if (found) return found;
    }
    await delay(100, signal);
  }
  throw new RequestError(502, "ComfyUI 没有返回图片。");
}

function firstImage(entry: unknown): { filename: string; subfolder: string; type: string } | null {
  if (!entry || typeof entry !== "object") return null;
  const outputs = (entry as { outputs?: unknown }).outputs;
  if (!outputs || typeof outputs !== "object") return null;
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const images = (node as { images?: unknown }).images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (!image || typeof image !== "object") continue;
      const filename = (image as { filename?: unknown }).filename;
      if (typeof filename !== "string" || !filename) continue;
      const subfolder = (image as { subfolder?: unknown }).subfolder;
      const type = (image as { type?: unknown }).type;
      return {
        filename,
        subfolder: typeof subfolder === "string" ? subfolder : "",
        type: typeof type === "string" && type ? type : "output",
      };
    }
  }
  return null;
}

function mediaTypeFromName(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Cancelled());
    }, { once: true });
  });
}
