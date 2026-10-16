import fs from "node:fs/promises";
import path from "node:path";

export type Settings = {
  ollamaBase: string;
  comfyBase: string;
  model: string;
};

export const DEFAULT_SETTINGS: Settings = {
  ollamaBase: "http://127.0.0.1:11434",
  comfyBase: "http://127.0.0.1:8188",
  model: "qwen3.8t",
};

export async function ensureSettings(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, "settings.json");
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, "utf8");
  }
}

export async function loadSettings(dataDir: string): Promise<Settings> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dataDir, "settings.json"), "utf8")) as Partial<Settings>;
    return {
      ollamaBase: textOr(parsed.ollamaBase, DEFAULT_SETTINGS.ollamaBase),
      comfyBase: textOr(parsed.comfyBase, DEFAULT_SETTINGS.comfyBase),
      model: textOr(parsed.model, DEFAULT_SETTINGS.model),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function textOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}
