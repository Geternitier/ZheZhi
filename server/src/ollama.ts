import { Cancelled, RequestError, isCancelled } from "./errors.js";
import { privateOrigin } from "./upstream.js";

const TIMEOUT_MS = 60_000;

export type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export async function complete(options: {
  base: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const origin = privateOrigin(options.base);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = AbortSignal.any([options.signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/chat", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        think: false,
        options: { temperature: 0.6, num_predict: 800 },
      }),
      signal,
    });
  } catch (err) {
    if (isCancelled(err, options.signal)) throw new Cancelled();
    if (isTimeout(err, timeout)) throw new RequestError(504, "等了太久还没有写出提示词。");
    throw new RequestError(502, "连不上 Ollama。请确认本机服务已启动。");
  }
  const data = await readJson(response);
  if (!response.ok) {
    const detail = errorText(data);
    if (response.status === 404 || /not found|model/i.test(detail)) {
      throw new RequestError(502, "没有找到模型。请检查设置里的模型名。");
    }
    throw new RequestError(502, "Ollama 没有完成提示词。");
  }
  const content = typeof data.message === "object" && data.message && "content" in data.message
    ? (data.message as { content?: unknown }).content
    : "";
  const text = cleanPrompt(typeof content === "string" ? content : "");
  if (!text) throw new RequestError(502, "模型没有写出提示词。");
  return text;
}

export async function checkOllama(base: string, fetchImpl?: typeof fetch): Promise<boolean> {
  try {
    const origin = privateOrigin(base);
    const response = await (fetchImpl ?? fetch)(new URL("/api/version", origin), {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
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

function errorText(data: Record<string, unknown>): string {
  return typeof data.error === "string" ? data.error : "";
}

function cleanPrompt(raw: string): string {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = stripped.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : stripped).trim();
}

function isTimeout(err: unknown, timeout: AbortSignal): boolean {
  return timeout.aborted || (err instanceof Error && (err.name === "TimeoutError" || /timeout/i.test(err.message)));
}
