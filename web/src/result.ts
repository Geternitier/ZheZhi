export type Mode = "text" | "image";

const EMPTY: Record<Mode, string> = {
  text: "写下要画的内容，然后生成。",
  image: "放入一张参考图，并写下要怎么画。",
};

export function createResult(root: HTMLElement) {
  const empty = required<HTMLParagraphElement>(root, "#empty");
  const picture = required<HTMLImageElement>(root, "#picture");
  let mode: Mode = "text";
  let busy = false;

  picture.addEventListener("error", () => {
    picture.hidden = true;
    empty.hidden = false;
    empty.textContent = "图片没有载入。";
  });

  return {
    setMode(next: Mode) {
      mode = next;
      syncEmpty();
    },
    setBusy(next: boolean) {
      busy = next;
      syncEmpty();
    },
    showEmpty() {
      busy = false;
      picture.hidden = true;
      picture.removeAttribute("src");
      syncEmpty();
    },
    showImage(image: string) {
      busy = false;
      empty.hidden = true;
      picture.hidden = false;
      picture.src = image;
    },
  };

  function syncEmpty() {
    const show = picture.hidden && !busy;
    empty.hidden = !show;
    if (show) empty.textContent = EMPTY[mode];
  }
}

function required<T extends Element>(root: HTMLElement, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
