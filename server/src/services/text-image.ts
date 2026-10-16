import { RATIOS, isRatio, type RatioId } from "@huijing/shared";
import type { OpenSocket } from "../comfy.js";
import { generateImage } from "../comfy.js";
import { RequestError } from "../errors.js";
import type { ServiceModule } from "../runs.js";
import { randomSeed } from "../seed.js";
import { sizeForRatio } from "../size.js";
import { privateOrigin } from "../upstream.js";
import { fillWorkflow, loadWorkflow } from "../workflow.js";

const MAX_TEXT = 8_000;

export function createTextImageService(deps: {
  workflowsDir: string;
  fetchImpl?: typeof fetch;
  openSocket?: OpenSocket;
}): ServiceModule {
  return {
    info: {
      name: "text.image",
      title: "文生图",
      input: [
        { name: "text", type: "text" },
        { name: "ratio", type: "enum", values: RATIOS },
      ],
    },
    parse(body) {
      return parseTextImage(body);
    },
    async run(input, ctx) {
      const job = input as { text: string; ratio: RatioId };
      privateOrigin(ctx.settings.comfyBase);
      const loaded = await loadWorkflow(deps.workflowsDir, "text.image");
      const size = sizeForRatio(job.ratio);
      const seed = randomSeed();
      const workflow = fillWorkflow(loaded.api, loaded.manifest, { prompt: job.text, ...size, seed });
      ctx.report({ phase: "sampling", prompt: job.text, seed, step: 0, total: null });
      const image = await generateImage({
        base: ctx.settings.comfyBase,
        workflow,
        signal: ctx.signal,
        onProgress: (step, total) => ctx.report({ phase: "sampling", step, total }),
        openSocket: deps.openSocket,
        fetchImpl: deps.fetchImpl,
      });
      ctx.setImage(image.bytes, image.mediaType);
    },
  };
}

function parseTextImage(body: unknown): { text: string; ratio: RatioId } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "请求不是 JSON。");
  }
  const record = body as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) throw new RequestError(400, "请填写要画的内容。");
  if (text.length > MAX_TEXT) throw new RequestError(400, "要画的内容太长。");
  if (!isRatio(record.ratio)) throw new RequestError(400, "比例不在规定的选项里。");
  return { text, ratio: record.ratio };
}
