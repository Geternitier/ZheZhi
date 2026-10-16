import fs from "node:fs/promises";
import path from "node:path";
import { RequestError } from "./errors.js";

const FIELDS = ["prompt", "width", "height", "seed"] as const;
type Field = (typeof FIELDS)[number];

const LABELS: Record<Field, string> = {
  prompt: "提示词",
  width: "宽",
  height: "高",
  seed: "种子",
};

export type WorkflowValues = {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  image?: string;
};

export type LoadedWorkflow = {
  api: Record<string, unknown>;
  manifest: Record<string, unknown>;
};

export async function loadWorkflow(dir: string, name: string): Promise<LoadedWorkflow> {
  const apiFile = path.join(dir, `${name}.api.json`);
  const manifestFile = path.join(dir, `${name}.manifest.json`);
  let apiText: string;
  let manifestText: string;
  try {
    [apiText, manifestText] = await Promise.all([
      fs.readFile(apiFile, "utf8"),
      fs.readFile(manifestFile, "utf8"),
    ]);
  } catch {
    throw new RequestError(500, `没有找到工作流 ${name}。`);
  }
  let api: unknown;
  let manifest: unknown;
  try {
    api = JSON.parse(apiText);
    manifest = JSON.parse(manifestText);
  } catch {
    throw new RequestError(500, `工作流 ${name} 不是合法的 JSON。`);
  }
  if (!api || typeof api !== "object" || Array.isArray(api)) {
    throw new RequestError(500, "工作流不是对象。");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new RequestError(500, "工作流映射不是对象。");
  }
  return { api: api as Record<string, unknown>, manifest: manifest as Record<string, unknown> };
}

export function fillWorkflow(
  template: Record<string, unknown>,
  manifest: Record<string, unknown>,
  values: WorkflowValues,
): Record<string, unknown> {
  const graph = structuredClone(template);
  for (const field of FIELDS) {
    const steps = readPath(manifest[field], LABELS[field]);
    writePath(graph, steps, values[field], LABELS[field]);
  }
  if (values.image !== undefined) {
    const steps = readPath(manifest.image, "参考图");
    writePath(graph, steps, values.image, "参考图");
  }
  return graph;
}

function readPath(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.some((part) => typeof part !== "string" || !part)) {
    throw new RequestError(500, `工作流映射缺少${label}。`);
  }
  return value as string[];
}

function writePath(graph: Record<string, unknown>, steps: string[], value: string | number, label: string): void {
  let current: unknown = graph;
  for (let index = 0; index < steps.length - 1; index += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new RequestError(500, `工作流里没有${label}对应的节点。`);
    }
    const next = (current as Record<string, unknown>)[steps[index]];
    if (next === undefined) throw new RequestError(500, `工作流里没有${label}对应的节点。`);
    current = next;
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new RequestError(500, `工作流里没有${label}对应的节点。`);
  }
  (current as Record<string, unknown>)[steps[steps.length - 1]] = value;
}
