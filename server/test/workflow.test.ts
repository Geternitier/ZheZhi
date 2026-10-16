import { describe, expect, it } from "vitest";
import { fillWorkflow } from "../src/workflow.js";

const template = {
  "3": { inputs: { seed: 0 } },
  "5": { inputs: { width: 1, height: 1 } },
  "6": { inputs: { text: "" } },
};

const manifest = {
  note: "ignored",
  prompt: ["6", "inputs", "text"],
  width: ["5", "inputs", "width"],
  height: ["5", "inputs", "height"],
  seed: ["3", "inputs", "seed"],
};

describe("fillWorkflow", () => {
  it("writes prompt, size, and seed without changing the template", () => {
    const filled = fillWorkflow(template, manifest, {
      prompt: "雨夜",
      width: 832,
      height: 1248,
      seed: 7,
    });
    expect(filled["6"]).toMatchObject({ inputs: { text: "雨夜" } });
    expect(filled["5"]).toMatchObject({ inputs: { width: 832, height: 1248 } });
    expect(filled["3"]).toMatchObject({ inputs: { seed: 7 } });
    expect(template["6"].inputs.text).toBe("");
  });

  it("writes the reference image when that mapping is present", () => {
    const withImage = {
      ...template,
      "12": { inputs: { image: "old.png" } },
    };
    const filled = fillWorkflow(withImage, { ...manifest, image: ["12", "inputs", "image"] }, {
      prompt: "雨夜",
      width: 832,
      height: 1248,
      seed: 7,
      image: "ref.png",
    });
    expect(filled["12"]).toMatchObject({ inputs: { image: "ref.png" } });
    const withResolution = fillWorkflow(withImage, { ...manifest, image: ["12", "inputs", "image"], resolution: ["6", "inputs", "resolution"] }, {
      prompt: "雨夜",
      width: 832,
      height: 1248,
      seed: 7,
      image: "ref.png",
      resolution: 1536,
    });
    expect(withResolution["6"]).toMatchObject({ inputs: { resolution: 1536 } });
    expect(() => fillWorkflow(template, manifest, {
      prompt: "a",
      width: 1,
      height: 1,
      seed: 1,
      image: "ref.png",
    })).toThrow(/缺少参考图/);
  });

  it("names the missing mapping and the missing node", () => {
    const broken = { ...manifest, width: "5.inputs.width" };
    expect(() => fillWorkflow(template, broken, { prompt: "a", width: 1, height: 1, seed: 1 })).toThrow(/缺少宽/);
    const missing = { ...manifest, seed: ["9", "inputs", "seed"] };
    expect(() => fillWorkflow(template, missing, { prompt: "a", width: 1, height: 1, seed: 1 })).toThrow(/没有种子对应的节点/);
  });
});
