const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

export function createViewer(dialog: HTMLDialogElement) {
  const stage = required<HTMLElement>(dialog, "#viewer-stage");
  const frame = required<HTMLElement>(dialog, "#viewer-frame");
  const image = required<HTMLImageElement>(dialog, "#viewer-image");
  const zoomOut = required<HTMLButtonElement>(dialog, "#viewer-out");
  const zoomIn = required<HTMLButtonElement>(dialog, "#viewer-in");
  const closeButton = required<HTMLButtonElement>(dialog, "#viewer-close");
  let zoom = MIN_ZOOM;

  zoomOut.addEventListener("click", () => change(zoom / ZOOM_STEP, center()));
  zoomIn.addEventListener("click", () => change(zoom * ZOOM_STEP, center()));
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    zoom = MIN_ZOOM;
    image.removeAttribute("src");
  });
  stage.addEventListener("wheel", (event) => {
    if (!dialog.open || !image.naturalWidth) return;
    event.preventDefault();
    const next = event.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP;
    change(next, pointAt(event.clientX, event.clientY));
  }, { passive: false });
  window.addEventListener("resize", () => {
    if (dialog.open && image.naturalWidth) layout(center());
  });

  return {
    open(src: string) {
      zoom = MIN_ZOOM;
      image.onload = () => layout({ x: 0.5, y: 0.5 });
      image.src = src;
      if (!dialog.open) dialog.showModal();
      if (image.complete && image.naturalWidth) layout({ x: 0.5, y: 0.5 });
      syncButtons();
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };

  function change(next: number, anchor: { x: number; y: number }) {
    const clamped = clamp(next);
    if (clamped === zoom) return;
    zoom = clamped;
    layout(anchor);
  }

  function layout(anchor: { x: number; y: number }) {
    const fit = fitted();
    frame.style.width = `${fit.width * zoom}px`;
    frame.style.height = `${fit.height * zoom}px`;
    syncButtons();
    requestAnimationFrame(() => {
      stage.scrollLeft = anchor.x * frame.offsetWidth - stage.clientWidth / 2;
      stage.scrollTop = anchor.y * frame.offsetHeight - stage.clientHeight / 2;
    });
  }

  function fitted(): { width: number; height: number } {
    const bounds = stage.getBoundingClientRect();
    const availW = Math.max(1, bounds.width - 32);
    const availH = Math.max(1, bounds.height - 32);
    const scale = Math.min(availW / image.naturalWidth, availH / image.naturalHeight);
    return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
  }

  function center(): { x: number; y: number } {
    const width = frame.offsetWidth || 1;
    const height = frame.offsetHeight || 1;
    return {
      x: (stage.scrollLeft + stage.clientWidth / 2) / width,
      y: (stage.scrollTop + stage.clientHeight / 2) / height,
    };
  }

  function pointAt(clientX: number, clientY: number): { x: number; y: number } {
    const bounds = stage.getBoundingClientRect();
    const width = frame.offsetWidth || 1;
    const height = frame.offsetHeight || 1;
    return {
      x: (stage.scrollLeft + clientX - bounds.left) / width,
      y: (stage.scrollTop + clientY - bounds.top) / height,
    };
  }

  function syncButtons() {
    zoomOut.disabled = zoom <= MIN_ZOOM + 0.001;
    zoomIn.disabled = zoom >= MAX_ZOOM - 0.001;
  }
}

function clamp(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  return node as T;
}
