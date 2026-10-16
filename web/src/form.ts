import { RATIOS, type RatioId } from "@huijing/shared";
import type { Mode } from "./result.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const RATIO_ORDER: RatioId[] = ["2:3", "1:1", "3:2", "16:9", "9:16"];

export type FormInput = {
  mode: Mode;
  text: string;
  ratio: RatioId;
  file: File | null;
};

export function createForm(options: {
  form: HTMLFormElement;
  modes: HTMLElement;
  onSubmit: () => void;
  onStop: () => void;
  onMode: (mode: Mode) => void;
  onChange: () => void;
}) {
  const text = required<HTMLTextAreaElement>(options.form, "#text");
  const imageField = required<HTMLElement>(options.form, "#image-field");
  const ratioField = required<HTMLElement>(options.form, "#ratio-field");
  const file = required<HTMLInputElement>(options.form, "#file");
  const drop = required<HTMLElement>(options.form, "#drop");
  const dropLabel = required<HTMLElement>(options.form, "#drop-label");
  const thumb = required<HTMLImageElement>(options.form, "#thumb");
  const clearImage = required<HTMLButtonElement>(options.form, "#clear-image");
  const generate = required<HTMLButtonElement>(options.form, "#generate");
  const error = required<HTMLParagraphElement>(options.form, "#form-error");
  const ratios = required<HTMLElement>(options.form, "#ratios");
  const copy = required<HTMLButtonElement>(options.form, "#copy");
  let mode: Mode = "text";
  let ratio: RatioId = "2:3";
  let image: File | null = null;
  let preview: string | null = null;
  let running = false;
  let ready = false;
  let locked = false;

  for (const value of RATIO_ORDER) {
    if (!(RATIOS as readonly string[]).includes(value)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ratio";
    button.setAttribute("aria-checked", String(value === ratio));
    const name = document.createElement("span");
    name.className = "ratio-name";
    name.textContent = value;
    const shape = document.createElement("i");
    shape.className = "shape";
    shape.style.aspectRatio = value.replace(":", " / ");
    button.append(name, shape);
    button.addEventListener("click", () => {
      ratio = value;
      for (const item of ratios.querySelectorAll<HTMLButtonElement>(".ratio")) {
        item.setAttribute("aria-checked", String(item === button));
      }
      options.onChange();
    });
    ratios.append(button);
  }

  text.addEventListener("input", () => {
    syncCopy();
    options.onChange();
  });
  copy.addEventListener("click", () => {
    const value = text.value.trim();
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      copy.textContent = "已复制";
      window.setTimeout(() => {
        copy.textContent = "复制提示词";
      }, 1200);
    }).catch(() => {
      copy.textContent = "请手动选择文字";
    });
  });
  file.addEventListener("change", () => {
    const next = file.files?.[0] ?? null;
    if (next && !takeFile(next)) return;
    options.onChange();
  });
  clearImage.addEventListener("click", () => {
    setFile(null);
    options.onChange();
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    const next = event.dataTransfer?.files?.[0];
    if (!next || !takeFile(next)) return;
    options.onChange();
  });

  for (const button of options.modes.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.addEventListener("click", () => {
      const next = button.dataset.mode === "image" ? "image" : "text";
      if (next === mode) return;
      setMode(next);
      options.onMode(next);
      options.onChange();
    });
  }

  options.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (running) options.onStop();
    else if (canSubmit()) options.onSubmit();
  });

  function showError(message: string) {
    error.hidden = !message;
    error.textContent = message;
  }

  function takeFile(next: File): boolean {
    if (!IMAGE_TYPES.has(next.type)) {
      showError("请使用 png、jpeg 或 webp。");
      file.value = "";
      return false;
    }
    showError("");
    setFile(next);
    return true;
  }

  function setFile(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    preview = next ? URL.createObjectURL(next) : null;
    image = next;
    file.value = "";
    thumb.hidden = !preview;
    dropLabel.hidden = Boolean(preview);
    clearImage.hidden = !preview;
    if (preview) thumb.src = preview;
    else thumb.removeAttribute("src");
  }

  function setMode(next: Mode) {
    mode = next;
    imageField.hidden = next !== "image";
    ratioField.hidden = next === "image";
    text.placeholder = next === "image" ? "写下要怎么画。" : "写下要画的内容。";
    for (const button of options.modes.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      button.setAttribute("aria-checked", String(button.dataset.mode === next));
    }
  }

  function canSubmit(): boolean {
    if (!text.value.trim()) return false;
    if (mode === "image" && !image) return false;
    return true;
  }

  function syncCopy() {
    copy.disabled = !text.value.trim();
  }

  function sync() {
    generate.textContent = running ? "停止" : "生成";
    generate.classList.toggle("hot", running);
    generate.disabled = locked || (running ? false : !ready || !canSubmit());
    syncCopy();
  }

  return {
    value(): FormInput {
      return { mode, text: text.value.trim(), ratio, file: image };
    },
    setMode,
    setRunning(next: boolean) {
      running = next;
      sync();
    },
    setLocked(next: boolean) {
      locked = next;
      sync();
    },
    setReady(next: boolean) {
      ready = next;
      sync();
    },
    setError: showError,
    setText(value: string) {
      if (!value.trim()) return;
      text.value = value;
      syncCopy();
    },
    sync,
  };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
