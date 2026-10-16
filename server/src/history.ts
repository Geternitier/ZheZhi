import fs from "node:fs/promises";
import path from "node:path";
import { isClientId, type HistoryEntry } from "@huijing/shared";

export const HISTORY_LIMIT = 12;
export const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type HistoryRecord = {
  id: string;
  createdAt: number;
  prompt: string;
  service: string;
  mediaType: string;
};

export type StoredImage = {
  bytes: Uint8Array;
  mediaType: string;
};

export function createHistory(options: { dataDir: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const historyDir = path.join(options.dataDir, "history");
  let tail = Promise.resolve();

  function exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function sweepUnlocked(): Promise<void> {
    const names = await fs.readdir(historyDir).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const clientId = name.slice(0, -".json".length);
      if (!isClientId(clientId)) continue;
      const file = path.join(historyDir, name);
      const current = await readRecords(file);
      const { kept, removed } = normalize(current, now());
      if (removed.length === 0 && kept.length === current.length) continue;
      await writeRecords(file, kept);
      await removeFiles(options.dataDir, removed);
    }
  }

  return {
    sweep(): Promise<void> {
      return exclusive(() => sweepUnlocked());
    },
    list(clientId: string): Promise<HistoryEntry[]> {
      return exclusive(async () => {
        await sweepUnlocked();
        const records = await readRecords(clientFile(historyDir, clientId));
        return records.map((record) => entry(record));
      });
    },
    remember(record: HistoryRecord & { clientId: string }): Promise<void> {
      return exclusive(async () => {
        await sweepUnlocked();
        const file = clientFile(historyDir, record.clientId);
        const current = await readRecords(file);
        const { kept, removed } = normalize([toRecord(record), ...current.filter((item) => item.id !== record.id)], now());
        await writeRecords(file, kept);
        await removeFiles(options.dataDir, removed);
      });
    },
    remove(clientId: string, id: string): Promise<boolean> {
      return exclusive(async () => {
        const file = clientFile(historyDir, clientId);
        const records = await readRecords(file);
        const target = records.find((record) => record.id === id);
        if (!target) return false;
        await writeRecords(file, records.filter((record) => record.id !== id));
        await removeFiles(options.dataDir, [target]);
        return true;
      });
    },
    readImage(id: string): Promise<StoredImage | null> {
      return exclusive(async () => {
        if (!isClientId(id)) return null;
        const names = await fs.readdir(historyDir).catch(() => [] as string[]);
        for (const name of names) {
          if (!name.endsWith(".json")) continue;
          const records = await readRecords(path.join(historyDir, name));
          const record = records.find((item) => item.id === id);
          if (!record) continue;
          if (now() - record.createdAt >= HISTORY_TTL_MS) return null;
          try {
            const bytes = await fs.readFile(outputFile(options.dataDir, record));
            return { bytes, mediaType: record.mediaType };
          } catch {
            return null;
          }
        }
        return null;
      });
    },
  };
}

export function imageExtension(mediaType: string): string {
  if (mediaType.includes("jpeg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

function toRecord(record: HistoryRecord & { clientId: string }): HistoryRecord {
  return {
    id: record.id,
    createdAt: record.createdAt,
    prompt: record.prompt,
    service: record.service,
    mediaType: record.mediaType,
  };
}

function entry(record: HistoryRecord): HistoryEntry {
  return {
    id: record.id,
    createdAt: record.createdAt,
    prompt: record.prompt,
    service: record.service,
    image: `/api/runs/${record.id}/image`,
  };
}

function clientFile(historyDir: string, clientId: string): string {
  return path.join(historyDir, `${clientId.toLowerCase()}.json`);
}

function outputFile(dataDir: string, record: HistoryRecord): string {
  return path.join(dataDir, "outputs", `${record.id}.${imageExtension(record.mediaType)}`);
}

function normalize(records: HistoryRecord[], now: number): { kept: HistoryRecord[]; removed: HistoryRecord[] } {
  const fresh = records.filter((record) => now - record.createdAt < HISTORY_TTL_MS);
  const removed = records.filter((record) => now - record.createdAt >= HISTORY_TTL_MS);
  fresh.sort((a, b) => b.createdAt - a.createdAt);
  return {
    kept: fresh.slice(0, HISTORY_LIMIT),
    removed: [...removed, ...fresh.slice(HISTORY_LIMIT)],
  };
}

async function readRecords(file: string): Promise<HistoryRecord[]> {
  try {
    return parseRecords(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return [];
  }
}

function parseRecords(value: unknown): HistoryRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<HistoryRecord>;
    if (!isClientId(row.id)) return [];
    if (typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)) return [];
    if (typeof row.prompt !== "string" || typeof row.service !== "string" || typeof row.mediaType !== "string") return [];
    return [{
      id: row.id.toLowerCase(),
      createdAt: row.createdAt,
      prompt: row.prompt,
      service: row.service,
      mediaType: row.mediaType,
    }];
  });
}

async function writeRecords(file: string, records: HistoryRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(records));
}

async function removeFiles(dataDir: string, records: HistoryRecord[]): Promise<void> {
  await Promise.all(records.map(async (record) => {
    await fs.rm(outputFile(dataDir, record), { force: true }).catch(() => undefined);
  }));
}
