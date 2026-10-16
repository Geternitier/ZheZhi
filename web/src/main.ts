import type { RunPhase, RunSnapshot } from "@huijing/shared";
import { ApiError, cancelRun, fetchHealth, fetchRun, openEvents, submitImage, submitText } from "./api.js";
import { createForm } from "./form.js";
import type { Mode } from "./result.js";
import { createResult } from "./result.js";
import { createWait, hasMeasuredProgress } from "./wait.js";

const SESSION_KEY = "huijing.web";

const form = createForm({
  form: required<HTMLFormElement>("#form"),
  modes: required<HTMLElement>("#modes"),
  onSubmit: () => void start(),
  onStop: () => void stop(),
  onMode: (mode) => {
    result.setMode(mode);
    saveSession();
  },
  onChange: () => form.sync(),
});
const wait = createWait(required("#wait"));
const result = createResult(required("#result"));

const state: { runId: string | null; running: boolean; stopping: boolean; close: (() => void) | null } = {
  runId: null,
  running: false,
  stopping: false,
  close: null,
};

restore();
void refreshHealth();
window.addEventListener("focus", () => void refreshHealth());

async function refreshHealth() {
  const health = await fetchHealth();
  form.setReady(health?.comfy === true);
}

async function start() {
  const input = form.value();
  if (input.mode === "image" && !input.file) return;
  form.setError("");
  form.setLocked(true);
  try {
    const created = input.mode === "image"
      ? await submitImage(input.text, input.file as File)
      : await submitText(input.text, input.ratio);
    state.runId = created.id;
    state.running = true;
    form.setRunning(true);
    result.setBusy(true);
    saveSession();
    wait.show(null, null);
    listen(created.id);
  } catch (err) {
    form.setError(messageOf(err));
    void refreshHealth();
  } finally {
    form.setLocked(false);
  }
}

async function stop() {
  if (!state.runId || state.stopping) return;
  state.stopping = true;
  try {
    await cancelRun(state.runId);
    state.close?.();
    state.close = null;
    state.running = false;
    form.setRunning(false);
    wait.stopped();
  } catch (err) {
    form.setError(messageOf(err));
  } finally {
    state.stopping = false;
  }
}

function listen(id: string) {
  state.close?.();
  state.close = openEvents(id, {
    progress: (event) => showProgress(event),
    done: (event) => {
      wait.clear();
      form.setText(event.prompt);
      result.showImage(event.image);
      finish("done");
    },
    error: (event) => {
      if (state.stopping || event.message === "已取消") {
        wait.stopped();
        finish("cancelled");
        return;
      }
      form.setError(event.message);
      finish("failed");
    },
    disconnect: () => void recover(id),
  });
}

async function recover(id: string) {
  if (state.runId !== id) return;
  const run = await fetchRun(id).catch(() => null);
  if (!run) {
    form.setError("连接中断，请再试一次。");
    finish("failed");
    return;
  }
  applySnapshot(run);
  if (isActive(run.phase)) listen(id);
}

function applySnapshot(run: RunSnapshot) {
  state.runId = run.id;
  if (run.phase === "done") {
    wait.clear();
    form.setText(run.prompt ?? "");
    result.showImage(`/api/runs/${run.id}/image`);
    finish("done");
    return;
  }
  if (run.phase === "failed") {
    form.setError(run.error || "生成失败。");
    finish("failed");
    return;
  }
  if (run.phase === "cancelled") {
    wait.stopped();
    finish("cancelled");
    return;
  }
  state.running = true;
  form.setRunning(true);
  result.setBusy(true);
  showProgress(run);
}

function finish(phase: RunPhase) {
  state.running = false;
  state.close = null;
  form.setRunning(false);
  if (phase !== "done") result.setBusy(false);
  if (phase === "done" || phase === "failed") wait.clear();
  saveSession();
}

function restore() {
  const saved = readSession();
  form.setMode(saved.mode);
  result.setMode(saved.mode);
  result.showEmpty();
  if (!saved.runId) return;
  state.runId = saved.runId;
  void fetchRun(saved.runId).then((run) => {
    if (!run) {
      state.runId = null;
      saveSession();
      return;
    }
    applySnapshot(run);
    if (isActive(run.phase)) listen(run.id);
  }).catch(() => {
    wait.clear();
  });
}

function saveSession() {
  const payload = JSON.stringify({ mode: form.value().mode, runId: state.runId });
  try {
    sessionStorage.setItem(SESSION_KEY, payload);
  } catch {
    // 隐私模式可能拒绝存储。这一次访问仍然可用。
  }
}

function readSession(): { mode: Mode; runId: string | null } {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as { mode?: unknown; runId?: unknown } | null;
    const mode = parsed?.mode === "image" ? "image" : "text";
    const runId = typeof parsed?.runId === "string" && parsed.runId ? parsed.runId : null;
    return { mode, runId };
  } catch {
    return { mode: "text", runId: null };
  }
}

function showProgress(event: { phase: RunPhase; step: number | null; total: number | null; etaMs: number | null }) {
  const ratio = hasMeasuredProgress(event) ? (event.step ?? 0) / (event.total ?? 1) : null;
  const measured = ratio != null && (event.step ?? 0) > 0 && (event.step ?? 0) < (event.total ?? 0);
  wait.show(ratio, measured ? event.etaMs : null);
}

function isActive(phase: RunPhase): boolean {
  return phase === "queued" || phase === "sampling";
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "没有连上本机服务。";
}

function required<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
