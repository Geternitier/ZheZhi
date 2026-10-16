import { isScale, SCALE_EDGE, type RatioId, type ScaleId } from "@huijing/shared";
import { RequestError } from "./errors.js";

const DEFAULT_EDGE = SCALE_EDGE["1k"];

const RATIO_PARTS: Record<RatioId, { width: number; height: number }> = {
  "1:1": { width: 1, height: 1 },
  "2:3": { width: 2, height: 3 },
  "3:2": { width: 3, height: 2 },
  "16:9": { width: 16, height: 9 },
  "9:16": { width: 9, height: 16 },
};

export function scaleOf(value: unknown): ScaleId {
  if (value === undefined || value === null) return "1k";
  if (!isScale(value)) throw new RequestError(400, "清晰度不在规定的选项里。");
  return value;
}

export function sizeForRatio(ratio: RatioId, edge = DEFAULT_EDGE): { width: number; height: number } {
  const parts = RATIO_PARTS[ratio];
  return sizeForPixels(parts.width, parts.height, edge);
}

export function sizeForPixels(width: number, height: number, edge = DEFAULT_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RequestError(400, "参考图无法读取。");
  }
  if (!(edge > 0) || !Number.isFinite(edge)) throw new RequestError(400, "清晰度不在规定的选项里。");
  const area = edge * edge;
  const ratio = width / height;
  return {
    width: roundTo32(Math.sqrt(area * ratio)),
    height: roundTo32(Math.sqrt(area / ratio)),
  };
}

export function roundTo32(value: number): number {
  const snapped = Math.round(value / 32) * 32;
  return Math.max(32, snapped);
}

export function readImageSize(bytes: Uint8Array, mediaType: string): { width: number; height: number } {
  if (mediaType === "image/png") return readPng(bytes);
  if (mediaType === "image/jpeg") return readJpeg(bytes);
  if (mediaType === "image/webp") return readWebp(bytes);
  throw new RequestError(400, "参考图只支持 png、jpeg 或 webp。");
}

export function imageMediaType(declared: string, bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  const sniffed = sniff(bytes);
  const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp") {
    if (sniffed !== normalized) throw new RequestError(400, "参考图无法读取。");
    return normalized;
  }
  if (!declared && sniffed) return sniffed;
  throw new RequestError(400, "参考图只支持 png、jpeg 或 webp。");
}

function sniff(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

function readPng(bytes: Uint8Array): { width: number; height: number } {
  if (!sniff(bytes) || bytes.length < 24 || !ascii(bytes, 12, "IHDR")) fail();
  const view = viewOf(bytes);
  return pair(view.getUint32(16), view.getUint32(20));
}

function readJpeg(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail();
  const view = viewOf(bytes);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) fail();
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) return pair(view.getUint16(offset + 7), view.getUint16(offset + 5));
    offset += 2 + length;
  }
  fail();
}

function readWebp(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30 || !ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) fail();
  const chunk = ascii(bytes, 12, "VP8X") ? "VP8X" : ascii(bytes, 12, "VP8L") ? "VP8L" : ascii(bytes, 12, "VP8 ") ? "VP8 " : "";
  if (chunk === "VP8X") {
    return pair(
      1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    );
  }
  if (chunk === "VP8 ") {
    const start = 23;
    if (bytes.length < start + 7 || bytes[start] !== 0x9d || bytes[start + 1] !== 0x01 || bytes[start + 2] !== 0x2a) fail();
    return pair(viewOf(bytes).getUint16(start + 3, true) & 0x3fff, viewOf(bytes).getUint16(start + 5, true) & 0x3fff);
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) fail();
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return pair((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  fail();
}

function pair(width: number, height: number): { width: number; height: number } {
  if (!width || !height) fail();
  return { width, height };
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function fail(): never {
  throw new RequestError(400, "参考图无法读取。");
}
