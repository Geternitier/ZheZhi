import type { HistoryEntry } from "@huijing/shared";
import { deleteHistory, fetchHistory } from "./api.js";
import type { Mode } from "./result.js";

export function createHistory(options: {
  root: HTMLElement;
  onOpen: (image: string) => void;
  onRemove: (image: string) => void;
}) {
  const grid = required<HTMLElement>(options.root, "#history-grid");
  const more = required<HTMLButtonElement>(options.root, "#history-more");
  let mode: Mode = "text";
  let open = false;
  let items: HistoryEntry[] = [];

  more.addEventListener("click", () => {
    open = !open;
    syncRow();
  });
  const observer = new ResizeObserver(() => syncRow());
  observer.observe(options.root);

  return {
    setMode(next: Mode) {
      mode = next;
      for (const button of grid.querySelectorAll<HTMLButtonElement>(".thumb-open")) {
        button.draggable = mode === "image";
      }
    },
    async reload(): Promise<HistoryEntry[]> {
      items = await fetchHistory();
      render();
      return items;
    },
  };

  function render() {
    grid.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "hist-item";
      const thumb = document.createElement("div");
      thumb.className = "thumb";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb-open";
      button.draggable = mode === "image";
      button.title = item.prompt;
      button.setAttribute("aria-label", item.prompt || "历史图片");
      const image = document.createElement("img");
      image.alt = "";
      image.src = item.image;
      button.append(image);
      thumb.append(button);
      button.addEventListener("dragstart", (event) => {
        if (mode !== "image" || !event.dataTransfer) {
          event.preventDefault();
          return;
        }
        const url = new URL(item.image, window.location.href).href;
        event.dataTransfer.setData("application/x-huijing-image", url);
        event.dataTransfer.setData("text/uri-list", url);
        event.dataTransfer.effectAllowed = "copy";
      });
      button.addEventListener("click", () => options.onOpen(item.image));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "thumb-del";
      remove.textContent = "删除";
      remove.addEventListener("click", () => {
        void removeItem(item);
      });
      row.append(thumb, remove);
      grid.append(row);
    }
    options.root.hidden = items.length === 0;
    syncRow();
  }

  async function removeItem(item: HistoryEntry) {
    await deleteHistory(item.id);
    items = items.filter((entry) => entry.id !== item.id);
    options.onRemove(item.image);
    render();
  }

  function syncRow() {
    const sample = grid.querySelector<HTMLElement>(".hist-item");
    if (!sample || options.root.hidden) {
      more.hidden = true;
      return;
    }
    const row = Math.ceil(sample.getBoundingClientRect().height);
    grid.style.maxHeight = "none";
    const overflows = grid.scrollHeight > row + 1;
    if (!open) grid.style.maxHeight = `${row}px`;
    more.hidden = !overflows;
    more.textContent = open ? "收起" : "展开";
    more.setAttribute("aria-expanded", String(open));
  }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
