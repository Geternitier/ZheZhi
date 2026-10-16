import { describe, expect, it } from "vitest";
import { estimateEta } from "../src/eta.js";

describe("estimateEta", () => {
  it("stays unknown until sampling steps are measured", () => {
    expect(estimateEta({
      phase: "queued",
      ahead: 1,
      step: null,
      total: null,
      samplingSamples: [20_000],
      samplingElapsedMs: null,
    })).toBeNull();
    expect(estimateEta({
      phase: "sampling",
      ahead: 0,
      step: 0,
      total: null,
      samplingSamples: [11_200],
      samplingElapsedMs: 1_000,
    })).toBeNull();
  });

  it("counts remaining steps once they are measured", () => {
    expect(estimateEta({
      phase: "sampling",
      ahead: 0,
      step: 1,
      total: 4,
      samplingSamples: [20_000],
      samplingElapsedMs: 3_000,
    })).toBe(9_000);
  });

  it("hides the leftover average once every step is done", () => {
    expect(estimateEta({
      phase: "sampling",
      ahead: 0,
      step: 25,
      total: 25,
      samplingSamples: [11_200],
      samplingElapsedMs: 11_000,
    })).toBe(0);
  });
});
