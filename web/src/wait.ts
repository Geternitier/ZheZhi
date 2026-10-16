import type { RunPhase } from "@huijing/shared";

const TAIL = 36;
const PENCIL_ANGLE = 60;
const SVG_NS = "http://www.w3.org/2000/svg";

export function hasMeasuredProgress(event: { phase: RunPhase; step: number | null; total: number | null }): boolean {
  return event.phase === "sampling" && event.step != null && event.total != null && event.total > 0;
}

export function formatEta(etaMs: number | null): string {
  if (etaMs == null || !Number.isFinite(etaMs) || etaMs <= 0) return "";
  const seconds = Math.max(1, Math.round(etaMs / 1000));
  if (seconds >= 60) return `大约还需 ${Math.max(1, Math.round(seconds / 60))} 分钟`;
  return `大约还需 ${seconds} 秒`;
}

export function createWait(node: HTMLElement) {
  const label = required<HTMLElement>(node, "#wait-label");
  const sketch = required<SVGSVGElement>(node, ".sketch");
  const guide = required<SVGPathElement>(node, ".guide");
  const trail = required<SVGGElement>(node, ".trail");
  const pencil = required<SVGGElement>(node, ".pencil");
  let frame = 0;
  let mode: "off" | "crawl" | "follow" = "off";
  let current = 0;
  let crawl = 0;
  let target = 0;

  function show(ratio: number | null, etaMs: number | null) {
    node.hidden = false;
    sketch.classList.remove("is-hidden");
    const text = formatEta(etaMs);
    label.hidden = !text;
    label.textContent = text;
    if (ratio == null) {
      if (mode !== "crawl") crawl = current;
      mode = "crawl";
    } else {
      mode = "follow";
      target = Math.min(1, Math.max(0, ratio));
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function tick() {
    frame = requestAnimationFrame(tick);
    if (mode === "crawl") {
      crawl = Math.min(0.4, crawl + 0.00035);
      target = crawl;
    }
    current += (target - current) * 0.045;
    draw(current);
  }

  function draw(ratio: number) {
    const length = guide.getTotalLength();
    if (!length) return;
    const head = Math.min(length, Math.max(0, ratio) * length);
    const start = Math.max(0, head - TAIL);
    const steps = 12;
    trail.replaceChildren();
    for (let i = 0; i < steps; i += 1) {
      const from = guide.getPointAtLength(start + ((head - start) * i) / steps);
      const to = guide.getPointAtLength(start + ((head - start) * (i + 1)) / steps);
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", from.x.toFixed(2));
      line.setAttribute("y1", from.y.toFixed(2));
      line.setAttribute("x2", to.x.toFixed(2));
      line.setAttribute("y2", to.y.toFixed(2));
      const near = (i + 1) / steps;
      line.setAttribute("stroke-width", (0.2 + near * near * 1.35).toFixed(2));
      trail.append(line);
    }
    const tip = guide.getPointAtLength(head);
    pencil.setAttribute("transform", `translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)}) rotate(${PENCIL_ANGLE})`);
  }

  function stopMotion() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    mode = "off";
  }

  return {
    show,
    stopped() {
      stopMotion();
      node.hidden = false;
      sketch.classList.add("is-hidden");
      label.hidden = false;
      label.textContent = "已停止";
    },
    clear() {
      stopMotion();
      current = 0;
      crawl = 0;
      target = 0;
      node.hidden = true;
      label.textContent = "";
      trail.replaceChildren();
    },
  };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
