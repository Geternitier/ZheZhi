import { describe, expect, it } from "vitest";
import { SCALE_EDGE } from "@huijing/shared";
import { roundTo32, scaleOf, sizeForPixels, sizeForRatio } from "../src/size.js";

describe("size", () => {
  it("matches the five ratios at standard clarity", () => {
    expect(sizeForRatio("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(sizeForRatio("2:3")).toEqual({ width: 832, height: 1248 });
    expect(sizeForRatio("3:2")).toEqual({ width: 1248, height: 832 });
    expect(sizeForRatio("16:9")).toEqual({ width: 1376, height: 768 });
    expect(sizeForRatio("9:16")).toEqual({ width: 768, height: 1376 });
  });

  it("scales the same ratios to high and ultra clarity", () => {
    expect(sizeForRatio("1:1", SCALE_EDGE["1.5k"])).toEqual({ width: 1536, height: 1536 });
    expect(sizeForRatio("2:3", SCALE_EDGE["1.5k"])).toEqual({ width: 1248, height: 1888 });
    expect(sizeForRatio("3:2", SCALE_EDGE["1.5k"])).toEqual({ width: 1888, height: 1248 });
    expect(sizeForRatio("16:9", SCALE_EDGE["1.5k"])).toEqual({ width: 2048, height: 1152 });
    expect(sizeForRatio("9:16", SCALE_EDGE["1.5k"])).toEqual({ width: 1152, height: 2048 });
    expect(sizeForRatio("1:1", SCALE_EDGE["2k"])).toEqual({ width: 2048, height: 2048 });
    expect(sizeForRatio("2:3", SCALE_EDGE["2k"])).toEqual({ width: 1664, height: 2496 });
    expect(sizeForRatio("3:2", SCALE_EDGE["2k"])).toEqual({ width: 2496, height: 1664 });
    expect(sizeForRatio("16:9", SCALE_EDGE["2k"])).toEqual({ width: 2720, height: 1536 });
    expect(sizeForRatio("9:16", SCALE_EDGE["2k"])).toEqual({ width: 1536, height: 2720 });
  });

  it("reads a scale and rejects an unknown one", () => {
    expect(scaleOf(undefined)).toBe("1k");
    expect(scaleOf("2k")).toBe("2k");
    expect(() => scaleOf("4k")).toThrow(/清晰度/);
    expect(() => scaleOf("")).toThrow(/清晰度/);
  });

  it("rounds an image ratio to the nearest multiple of 32, ties upward", () => {
    expect(sizeForPixels(100, 200)).toEqual({ width: 736, height: 1440 });
    expect(sizeForPixels(2048, 1536)).toEqual({ width: 1184, height: 896 });
    expect(roundTo32(80)).toBe(96);
    expect(roundTo32(16)).toBe(32);
    expect(roundTo32(32)).toBe(32);
  });
});
