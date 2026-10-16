import { describe, expect, it } from "vitest";
import { roundTo32, sizeForPixels, sizeForRatio } from "../src/size.js";

describe("size", () => {
  it("matches the five ratios", () => {
    expect(sizeForRatio("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(sizeForRatio("2:3")).toEqual({ width: 832, height: 1248 });
    expect(sizeForRatio("3:2")).toEqual({ width: 1248, height: 832 });
    expect(sizeForRatio("16:9")).toEqual({ width: 1376, height: 768 });
    expect(sizeForRatio("9:16")).toEqual({ width: 768, height: 1376 });
  });

  it("rounds an image ratio to the nearest multiple of 32, ties upward", () => {
    expect(sizeForPixels(100, 200)).toEqual({ width: 736, height: 1440 });
    expect(sizeForPixels(2048, 1536)).toEqual({ width: 1184, height: 896 });
    expect(roundTo32(80)).toBe(96);
    expect(roundTo32(16)).toBe(32);
    expect(roundTo32(32)).toBe(32);
  });
});
