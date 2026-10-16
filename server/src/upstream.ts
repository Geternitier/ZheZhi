import { RequestError } from "./errors.js";

export function privateOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new RequestError(400, "地址不是合法的 URL。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RequestError(400, "只支持 http 或 https。");
  }
  if (url.username || url.password) {
    throw new RequestError(400, "地址里不要带账号密码。");
  }
  if (!isPrivateHost(url.hostname.toLowerCase().replace(/^\[|\]$/g, ""))) {
    throw new RequestError(400, "只允许本机或局域网地址。");
  }
  return url.origin;
}

export function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "host.docker.internal") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function wsOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}
