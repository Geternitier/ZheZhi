import { isClientId } from "@huijing/shared";

const KEY = "huijing.client";

let memory = "";

export function clientId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (isClientId(saved)) return saved.toLowerCase();
    const next = newClientId();
    localStorage.setItem(KEY, next);
    memory = next;
    return next;
  } catch {
    if (!isClientId(memory)) memory = newClientId();
    return memory;
  }
}

function newClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
