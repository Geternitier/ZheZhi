import { isClientId } from "@huijing/shared";

const KEY = "huijing.client";

let memory = "";

export function clientId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (isClientId(saved)) return saved.toLowerCase();
    const next = crypto.randomUUID();
    localStorage.setItem(KEY, next);
    memory = next;
    return next;
  } catch {
    if (!isClientId(memory)) memory = crypto.randomUUID();
    return memory;
  }
}
