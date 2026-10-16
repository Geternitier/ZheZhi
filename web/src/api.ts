import type { DoneEvent, ErrorEvent, HealthStatus, ProgressEvent, RatioId, RunSnapshot } from "@huijing/shared";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchHealth(): Promise<HealthStatus | null> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<HealthStatus>;
    return {
      ok: body.ok === true,
      comfy: body.comfy === true,
      running: body.running === true,
    };
  } catch {
    return null;
  }
}

export async function submitText(text: string, ratio: RatioId): Promise<{ id: string; etaMs: number | null }> {
  return readJson(await fetch("/api/services/text.image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ratio }),
  }));
}

export async function submitImage(text: string, image: File): Promise<{ id: string; etaMs: number | null }> {
  const body = new FormData();
  body.set("text", text);
  body.set("image", image);
  return readJson(await fetch("/api/services/image.image", { method: "POST", body }));
}

export async function fetchRun(id: string): Promise<RunSnapshot | null> {
  const response = await fetch(`/api/runs/${id}`);
  if (response.status === 404) return null;
  return readJson(response);
}

export async function cancelRun(id: string): Promise<void> {
  await readJson(await fetch(`/api/runs/${id}/cancel`, { method: "POST" }));
}

export function openEvents(
  id: string,
  handlers: {
    progress: (event: ProgressEvent) => void;
    done: (event: DoneEvent) => void;
    error: (event: ErrorEvent) => void;
    disconnect: () => void;
  },
): () => void {
  const source = new EventSource(`/api/runs/${id}/events`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.addEventListener("progress", (event) => {
    handlers.progress(parseData<ProgressEvent>(event));
  });
  source.addEventListener("done", (event) => {
    handlers.done(parseData<DoneEvent>(event));
    close();
  });
  source.addEventListener("error", (event) => {
    if (event instanceof MessageEvent) {
      handlers.error(parseData<ErrorEvent>(event));
      close();
      return;
    }
    if (closed) return;
    close();
    handlers.disconnect();
  });
  return close;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : "没有完成这次请求。";
    throw new ApiError(message);
  }
  return body as T;
}

function parseData<T>(event: Event): T {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    throw new ApiError("进度数据无法读取。");
  }
  return JSON.parse(event.data) as T;
}
