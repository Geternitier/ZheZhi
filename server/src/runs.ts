import fs from "node:fs/promises";
import path from "node:path";
import type { DoneEvent, ErrorEvent, ProgressEvent, RunPhase, RunSnapshot, ServiceInfo } from "@huijing/shared";
import { estimateEta } from "./eta.js";
import { RequestError, isCancelled } from "./errors.js";
import { loadSettings, type Settings } from "./settings.js";

export type RunEvent =
  | { event: "progress"; data: ProgressEvent }
  | { event: "done"; data: DoneEvent }
  | { event: "error"; data: ErrorEvent };

export type RunContext = {
  signal: AbortSignal;
  settings: Settings;
  report: (patch: {
    phase?: RunPhase;
    step?: number | null;
    total?: number | null;
    prompt?: string | null;
    seed?: number | null;
  }) => void;
  setImage: (bytes: Uint8Array, mediaType: string) => void;
};

export type ServiceModule = {
  info: ServiceInfo;
  parse: (body: unknown) => unknown | Promise<unknown>;
  run: (input: unknown, ctx: RunContext) => Promise<void>;
};

type Samples = {
  samplingMs: number[];
};

type Run = {
  id: string;
  service: string;
  phase: RunPhase;
  etaMs: number | null;
  step: number | null;
  total: number | null;
  prompt: string | null;
  seed: number | null;
  error: string | null;
  input: unknown;
  controller: AbortController;
  listeners: Set<(event: RunEvent) => void>;
  image: { bytes: Uint8Array; mediaType: string } | null;
  phaseStartedAt: number;
};

export function createRuns(options: { dataDir: string; services: ServiceModule[]; now?: () => number }) {
  const now = options.now ?? Date.now;
  const services = new Map(options.services.map((service) => [service.info.name, service]));
  const runs = new Map<string, Run>();
  const queue: string[] = [];
  let activeId: string | null = null;
  let pumping = false;
  let samples: Samples = { samplingMs: [] };
  const timingsFile = path.join(options.dataDir, "timings.json");
  let loading: Promise<void> | null = null;

  function readySamples(): Promise<void> {
    if (!loading) {
      loading = loadSamples(timingsFile).then((value) => {
        samples = value;
      });
    }
    return loading;
  }

  function aheadOf(id: string): number {
    if (activeId === id) return 0;
    const index = queue.indexOf(id);
    if (index < 0) return 0;
    const before = queue.slice(0, index).filter((queuedId) => {
      const queued = runs.get(queuedId);
      return queued && queued.phase !== "cancelled" && queued.phase !== "failed" && queued.phase !== "done";
    }).length;
    return (activeId ? 1 : 0) + before;
  }

  function etaFor(run: Run): number | null {
    if (run.phase !== "queued" && run.phase !== "sampling") return null;
    return estimateEta({
      phase: run.phase,
      ahead: aheadOf(run.id),
      step: run.step,
      total: run.total,
      samplingSamples: samples.samplingMs,
      samplingElapsedMs: run.phase === "sampling" ? Math.max(0, now() - run.phaseStartedAt) : null,
    });
  }

  function snapshot(run: Run): RunSnapshot {
    return {
      id: run.id,
      service: run.service,
      phase: run.phase,
      etaMs: run.etaMs,
      step: run.step,
      total: run.total,
      prompt: run.prompt,
      seed: run.seed,
      error: run.error,
    };
  }

  function emit(run: Run, event: RunEvent) {
    for (const listener of [...run.listeners]) listener(event);
  }

  function publish(run: Run) {
    if (run.phase === "done" || run.phase === "failed" || run.phase === "cancelled") return;
    run.etaMs = etaFor(run);
    emit(run, {
      event: "progress",
      data: { phase: run.phase, etaMs: run.etaMs, step: run.step, total: run.total },
    });
  }

  function finish(run: Run, phase: "done" | "failed" | "cancelled", message: string | null) {
    if (run.phase === "done" || run.phase === "failed" || run.phase === "cancelled") return;
    run.phase = phase;
    run.etaMs = null;
    run.error = message;
    const event: RunEvent = phase === "done"
      ? {
        event: "done",
        data: {
          prompt: run.prompt ?? "",
          seed: run.seed ?? 0,
          image: `/api/runs/${run.id}/image`,
        },
      }
      : { event: "error", data: { message: message || "生成失败。" } };
    emit(run, event);
  }

  function remember(kind: keyof Samples, value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    samples[kind] = [...samples[kind], Math.round(value)].slice(-8);
    void saveSamples(timingsFile, samples);
  }

  async function execute(run: Run) {
    const service = services.get(run.service);
    if (!service) {
      finish(run, "failed", "没有这个生成服务。");
      return;
    }
    const settings = await loadSettings(options.dataDir);
    let samplingStarted = 0;
    try {
      await service.run(run.input, {
        signal: run.controller.signal,
        settings,
        report(patch) {
          if (run.phase === "done" || run.phase === "failed" || run.phase === "cancelled") return;
          if (patch.phase && patch.phase !== run.phase) {
            run.phase = patch.phase;
            run.phaseStartedAt = now();
            if (patch.phase === "sampling") samplingStarted = run.phaseStartedAt;
          }
          if (patch.step !== undefined) run.step = patch.step;
          if (patch.total !== undefined) run.total = patch.total;
          if (patch.prompt !== undefined) run.prompt = patch.prompt;
          if (patch.seed !== undefined) run.seed = patch.seed;
          publish(run);
        },
        setImage(bytes, mediaType) {
          run.image = { bytes, mediaType };
        },
      });
      if (run.controller.signal.aborted || run.phase === "cancelled") return;
      if (!run.prompt || run.seed === null || !run.image) {
        finish(run, "failed", "生成没有完成。");
        return;
      }
      await writeImage(options.dataDir, run);
      if (samplingStarted) remember("samplingMs", now() - samplingStarted);
      finish(run, "done", null);
    } catch (err) {
      if (isCancelled(err, run.controller.signal) || run.phase === "cancelled") return;
      const message = err instanceof Error && err.message ? err.message : "生成失败。";
      console.error(`运行 ${run.id} 失败：${message}`);
      finish(run, "failed", message);
    }
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const id = queue.shift();
        if (!id) continue;
        const run = runs.get(id);
        if (!run || run.phase === "cancelled" || run.phase === "failed" || run.phase === "done") continue;
        activeId = id;
        await execute(run);
        activeId = null;
      }
    } finally {
      pumping = false;
      activeId = null;
      if (queue.length) void pump();
    }
  }

  return {
    listServices(): ServiceInfo[] {
      return [...services.values()].map((service) => service.info);
    },
    running(): boolean {
      if (activeId) {
        const active = runs.get(activeId);
        if (active && active.phase !== "done" && active.phase !== "failed" && active.phase !== "cancelled") return true;
      }
      return queue.some((id) => {
        const run = runs.get(id);
        return run && run.phase !== "cancelled" && run.phase !== "failed" && run.phase !== "done";
      });
    },
    async submit(name: string, body: unknown): Promise<{ id: string; etaMs: number | null }> {
      const service = services.get(name);
      if (!service) throw new RequestError(404, "没有这个生成服务。");
      const input = await service.parse(body);
      await readySamples();
      const run: Run = {
        id: crypto.randomUUID(),
        service: name,
        phase: "queued",
        etaMs: null,
        step: null,
        total: null,
        prompt: null,
        seed: null,
        error: null,
        input,
        controller: new AbortController(),
        listeners: new Set(),
        image: null,
        phaseStartedAt: now(),
      };
      runs.set(run.id, run);
      queue.push(run.id);
      run.etaMs = etaFor(run);
      void pump();
      return { id: run.id, etaMs: run.etaMs };
    },
    get(id: string): RunSnapshot | null {
      const run = runs.get(id);
      return run ? snapshot(run) : null;
    },
    image(id: string): { bytes: Uint8Array; mediaType: string } | null {
      return runs.get(id)?.image ?? null;
    },
    cancel(id: string): RunSnapshot {
      const run = runs.get(id);
      if (!run) throw new RequestError(404, "没有这次运行。");
      if (run.phase === "queued" || run.phase === "sampling") {
        run.controller.abort();
        finish(run, "cancelled", "已取消");
      }
      return snapshot(run);
    },
    subscribe(id: string, listener: (event: RunEvent) => void): () => void {
      const run = runs.get(id);
      if (!run) throw new RequestError(404, "没有这次运行。");
      run.listeners.add(listener);
      listener(eventFor(run));
      return () => run.listeners.delete(listener);
    },
  };
}

function eventFor(run: Run): RunEvent {
  if (run.phase === "done") {
    return {
      event: "done",
      data: { prompt: run.prompt ?? "", seed: run.seed ?? 0, image: `/api/runs/${run.id}/image` },
    };
  }
  if (run.phase === "failed" || run.phase === "cancelled") {
    return { event: "error", data: { message: run.error || "生成失败。" } };
  }
  return { event: "progress", data: { phase: run.phase, etaMs: run.etaMs, step: run.step, total: run.total } };
}

async function loadSamples(file: string): Promise<Samples> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Samples>;
    return { samplingMs: numbers(parsed.samplingMs) };
  } catch {
    return { samplingMs: [] };
  }
}

function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(-8);
}

async function saveSamples(file: string, samples: Samples): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(samples), "utf8");
  } catch {
    // 耗时记不下来时，仍用默认估计。
  }
}

async function writeImage(dataDir: string, run: Run): Promise<void> {
  if (!run.image) return;
  try {
    const dir = path.join(dataDir, "outputs");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${run.id}.${extension(run.image.mediaType)}`), run.image.bytes);
  } catch (err) {
    console.error(err);
  }
}

function extension(mediaType: string): string {
  if (mediaType.includes("jpeg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}
