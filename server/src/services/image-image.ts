import { SCALE_EDGE, SCALES, type ScaleId } from "@huijing/shared";
import type { OpenSocket } from "../comfy.js";
import { generateImage, uploadImage } from "../comfy.js";
import { RequestError } from "../errors.js";
import type { ServiceModule } from "../runs.js";
import { randomSeed } from "../seed.js";
import { imageMediaType, readImageSize, scaleOf, sizeForPixels } from "../size.js";
import { privateOrigin } from "../upstream.js";
import { fillWorkflow, loadWorkflow } from "../workflow.js";

const MAX_TEXT = 8_000;
const MAX_IMAGE = 12 * 1024 * 1024;

type ImageJob = {
  text: string;
  scale: ScaleId;
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
};

export function createImageImageService(deps: {
  workflowsDir: string;
  fetchImpl?: typeof fetch;
  openSocket?: OpenSocket;
}): ServiceModule {
  return {
    info: {
      name: "image.image",
      title: "图生图",
      input: [
        { name: "text", type: "text" },
        { name: "image", type: "image" },
        { name: "scale", type: "enum", values: SCALES },
      ],
    },
    parse(body) {
      return parseImageImage(body);
    },
    async run(input, ctx) {
      const job = input as ImageJob;
      privateOrigin(ctx.settings.comfyBase);
      const loaded = await loadWorkflow(deps.workflowsDir, "image.image");
      const edge = SCALE_EDGE[job.scale];
      const size = sizeForPixels(job.width, job.height, edge);
      const seed = randomSeed();
      fillWorkflow(loaded.api, loaded.manifest, {
        prompt: job.text,
        ...size,
        seed,
        image: "preflight.png",
        resolution: edge,
      });
      ctx.report({ phase: "sampling", prompt: job.text, seed, step: 0, total: null });
      const filename = await uploadImage({
        base: ctx.settings.comfyBase,
        bytes: job.bytes,
        mediaType: job.mediaType,
        filename: `huijing-${crypto.randomUUID()}${extension(job.mediaType)}`,
        signal: ctx.signal,
        fetchImpl: deps.fetchImpl,
      });
      const workflow = fillWorkflow(loaded.api, loaded.manifest, {
        prompt: job.text,
        ...size,
        seed,
        image: filename,
        resolution: edge,
      });
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

async function parseImageImage(body: unknown): Promise<ImageJob> {
  if (!body || typeof body !== "object") throw new RequestError(400, "请上传一张参考图。");
  const record = body as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) throw new RequestError(400, "请填写要画的内容。");
  if (text.length > MAX_TEXT) throw new RequestError(400, "要画的内容太长。");
  const scale = scaleOf(record.scale);
  const file = record.image;
  if (!isUpload(file) || file.size === 0) throw new RequestError(400, "请上传一张参考图。");
  if (file.size > MAX_IMAGE) throw new RequestError(400, "参考图太大。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = imageMediaType(file.type, bytes);
  const pixels = readImageSize(bytes, mediaType);
  return { text, scale, bytes, mediaType, width: pixels.width, height: pixels.height };
}

function isUpload(value: unknown): value is File {
  return typeof value === "object"
    && value !== null
    && typeof (value as File).arrayBuffer === "function"
    && typeof (value as File).size === "number"
    && typeof (value as File).type === "string";
}

function extension(mediaType: string): string {
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  return ".png";
}
