import { createViewer } from "./viewer.js";

export type Mode = "text" | "image";

const EMPTY: Record<Mode, string> = {
  text: "写下要画的内容，然后生成。",
  image: "放入一张参考图，并写下要怎么画。",
};

export function createResult(root: HTMLElement) {
  const empty = required<HTMLParagraphElement>(root, "#empty");
  const picture = required<HTMLImageElement>(root, "#picture");
  const viewer = createViewer(requiredDialog());
  let mode: Mode = "text";
  let busy = false;
  let dragged = false;

  picture.addEventListener("error", () => {
    picture.hidden = true;
    empty.hidden = false;
    empty.textContent = "图片没有载入。";
    syncDrag();
  });
  picture.addEventListener("pointerdown", () => {
    dragged = false;
  });
  picture.addEventListener("dragstart", (event) => {
    if (!picture.draggable || !picture.getAttribute("src")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("application/x-huijing-image", picture.src);
    event.dataTransfer?.setData("text/uri-list", picture.src);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    dragged = true;
  });
  picture.addEventListener("click", () => {
    if (dragged) {
      dragged = false;
      return;
    }
    const src = picture.getAttribute("src");
    if (!src || picture.hidden) return;
    viewer.open(picture.src);
  });

  return {
    setMode(next: Mode) {
      mode = next;
      syncEmpty();
      syncDrag();
    },
    setBusy(next: boolean) {
      busy = next;
      syncEmpty();
    },
    showEmpty() {
      busy = false;
      picture.hidden = true;
      picture.removeAttribute("src");
      viewer.close();
      syncEmpty();
      syncDrag();
    },
    showImage(image: string) {
      busy = false;
      empty.hidden = true;
      picture.hidden = false;
      picture.src = image;
      syncDrag();
    },
  };

  function syncEmpty() {
    const show = picture.hidden && !busy;
    empty.hidden = !show;
    if (show) empty.textContent = EMPTY[mode];
  }

  function syncDrag() {
    const shown = !picture.hidden && Boolean(picture.getAttribute("src"));
    const canDrag = mode === "image" && shown;
    picture.draggable = canDrag;
    if (canDrag) picture.title = "查看大图，或拖到参考图";
    else if (shown) picture.title = "查看大图";
    else picture.removeAttribute("title");
  }
}

function requiredDialog(): HTMLDialogElement {
  const node = document.querySelector("#viewer");
  if (!(node instanceof HTMLDialogElement)) throw new Error("缺少 #viewer");
  return node;
}

function required<T extends Element>(root: HTMLElement, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
