export const RATIOS = ["1:1", "2:3", "3:2", "16:9", "9:16"] as const;
export const SCALES = ["1k", "1.5k", "2k"] as const;
export const SCALE_EDGE: Record<(typeof SCALES)[number], number> = {
  "1k": 1024,
  "1.5k": 1536,
  "2k": 2048,
};

export type RatioId = (typeof RATIOS)[number];
export type ScaleId = (typeof SCALES)[number];
export type RunPhase = "queued" | "sampling" | "done" | "failed" | "cancelled";

export type ServiceField =
  | { name: string; type: "text" }
  | { name: string; type: "enum"; values: readonly string[] }
  | { name: string; type: "image" };

export type ServiceInfo = {
  name: string;
  title: string;
  input: ServiceField[];
};

export type RunSnapshot = {
  id: string;
  service: string;
  phase: RunPhase;
  etaMs: number | null;
  step: number | null;
  total: number | null;
  prompt: string | null;
  seed: number | null;
  error: string | null;
};

export type ProgressEvent = {
  phase: RunPhase;
  etaMs: number | null;
  step: number | null;
  total: number | null;
};

export type DoneEvent = {
  prompt: string;
  seed: number;
  image: string;
};

export type ErrorEvent = {
  message: string;
};

export type HealthStatus = {
  ok: boolean;
  comfy: boolean;
  running: boolean;
};

export function isRatio(value: unknown): value is RatioId {
  return typeof value === "string" && (RATIOS as readonly string[]).includes(value);
}

export function isScale(value: unknown): value is ScaleId {
  return typeof value === "string" && (SCALES as readonly string[]).includes(value);
}
