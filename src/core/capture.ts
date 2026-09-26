import { drawMarks, type AnnotationMark } from "./annotation";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// The browser draws the screenshot itself (SVG foreignObject via
// modern-screenshot): masks, blend modes, filters, closed <details>, sliders
// and media controls come out as seen. html2canvas rebuilds the page with its
// own renderer and misses all of those; it stays as the fallback when the
// browser renderer fails or returns a flat picture (older Safari).

const SCROLL_MARK = "data-pointout-scroll";
const FIXED_MARK = "data-pointout-fixed";
const RASTER_MARK = "data-pointout-raster";
const XLINK = "http://www.w3.org/1999/xlink";

type RasterizeSvg = (svg: SVGSVGElement, width: number, height: number) => Promise<string>;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Draws one SVG on its own, with its pictures inlined and its CSS colours baked in. */
async function paintSvg(svg: SVGSVGElement, width: number, height: number): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const liveParts = Array.from(svg.querySelectorAll("*"));
  Array.from(copy.querySelectorAll("*")).forEach((part, index) => {
    const style = getComputedStyle(liveParts[index]);
    for (const property of ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity"]) {
      (part as SVGElement).style.setProperty(property, style.getPropertyValue(property));
    }
  });
  for (const image of Array.from(copy.querySelectorAll("image"))) {
    const href = image.getAttribute("href") ?? image.getAttributeNS(XLINK, "href");
    if (!href || href.startsWith("data:")) continue;
    const response = await fetch(new URL(href, document.baseURI).href);
    if (!response.ok) throw new Error(`Bild ${response.status}`);
    image.setAttribute("href", await readAsDataUrl(await response.blob()));
    image.removeAttributeNS(XLINK, "href");
  }
  const picture = new Image();
  picture.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  canvas.getContext("2d")?.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/**
 * Safari leaves pictures inside an SVG (mask, pattern, image) empty when the
 * whole page is drawn as one SVG. Such SVGs are painted beforehand and swapped
 * in; plain icons stay vector. A failure keeps the live SVG.
 */
async function paintPictureSvgs(rasterize: RasterizeSvg): Promise<{ images: string[]; clear: () => void }> {
  const images: string[] = [];
  const marked: Element[] = [];
  for (const svg of Array.from(document.body.querySelectorAll("svg"))) {
    if (!svg.querySelector("image") || svg.parentElement?.closest("svg")) continue;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) continue;
    try {
      images.push(await rasterize(svg, rect.width, rect.height));
    } catch {
      continue;
    }
    svg.setAttribute(RASTER_MARK, `${images.length - 1},${rect.width},${rect.height}`);
    marked.push(svg);
  }
  return { images, clear: () => marked.forEach((svg) => svg.removeAttribute(RASTER_MARK)) };
}

/** True when every sampled pixel has (almost) the same colour. */
export function isUniformImage(pixels: Uint8ClampedArray, tolerance = 8): boolean {
  for (let index = 4; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(pixels[index + channel] - pixels[channel]) > tolerance) return false;
    }
  }
  return true;
}

async function looksBlank(dataUrl: string): Promise<boolean> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Screenshot konnte nicht geprüft werden."));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return isUniformImage(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

function pageBackground(): string {
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  const rootBackground = getComputedStyle(document.documentElement).backgroundColor;
  return [bodyBackground, rootBackground].find((color) =>
    color && color !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/.test(color)
  ) ?? "#ffffff";
}

function shift(element: HTMLElement, left: number, top: number) {
  const current = element.style.transform;
  const offset = `translate(${-left}px, ${-top}px)`;
  element.style.transform = current && current !== "none" ? `${offset} ${current}` : offset;
}

/**
 * A drawn copy has no scroll state. Remember where each scrolled panel (and
 * the page) stands so the copy can move its content by the same amount, and
 * where fixed bars sit so they stay put when the page itself is shifted.
 */
function markLayout(): { page: { left: number; top: number }; clear: () => void } {
  const marked: Element[] = [];
  const scroller = document.scrollingElement ?? document.documentElement;
  const page = { left: scroller.scrollLeft, top: scroller.scrollTop };
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (element.scrollTop > 0 || element.scrollLeft > 0) {
      element.setAttribute(SCROLL_MARK, `${element.scrollLeft},${element.scrollTop}`);
      marked.push(element);
    }
  }
  if (page.left || page.top) {
    const body = document.body.getBoundingClientRect();
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (getComputedStyle(element).position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      element.setAttribute(FIXED_MARK, [rect.left - body.left, rect.top - body.top, rect.width, rect.height].join(","));
      marked.push(element);
    }
  }
  return {
    page,
    clear: () => marked.forEach((element) => { element.removeAttribute(SCROLL_MARK); element.removeAttribute(FIXED_MARK); }),
  };
}

function prepareCopy(root: Element, page: { left: number; top: number }, painted: string[]) {
  root.querySelectorAll<SVGSVGElement>(`[${RASTER_MARK}]`).forEach((svg) => {
    const [index, width, height] = (svg.getAttribute(RASTER_MARK) ?? "").split(",").map(Number);
    const picture = svg.ownerDocument.createElement("img");
    picture.setAttribute("style", svg.getAttribute("style") ?? "");
    picture.setAttribute("class", svg.getAttribute("class") ?? "");
    picture.src = painted[index];
    picture.alt = "";
    Object.assign(picture.style, { width: `${width}px`, height: `${height}px` });
    svg.replaceWith(picture);
  });
  root.querySelectorAll<HTMLElement>("[data-pointout-private]").forEach((element) => { element.style.visibility = "hidden"; });
  root.querySelectorAll<HTMLInputElement>("input[type=password], input[autocomplete=current-password], input[autocomplete=one-time-code]")
    .forEach((input) => { input.value = ""; input.setAttribute("value", ""); });
  root.querySelectorAll<HTMLElement>(`[${SCROLL_MARK}]`).forEach((panel) => {
    const [left, top] = (panel.getAttribute(SCROLL_MARK) ?? "0,0").split(",").map(Number);
    panel.removeAttribute(SCROLL_MARK);
    panel.style.overflow = "hidden";
    Array.from(panel.children).forEach((child) => shift(child as HTMLElement, left, top));
  });
  if (page.left || page.top) {
    Array.from(root.children).forEach((child) => shift(child as HTMLElement, page.left, page.top));
    // The shifted body now holds fixed bars; put them where they were on screen.
    root.querySelectorAll<HTMLElement>(`[${FIXED_MARK}]`).forEach((bar) => {
      const [left, top, width, height] = (bar.getAttribute(FIXED_MARK) ?? "").split(",").map(Number);
      bar.removeAttribute(FIXED_MARK);
      Object.assign(bar.style, { top: `${top}px`, left: `${left}px`, bottom: "auto", right: "auto", width: `${width}px`, height: `${height}px`, margin: "0", transform: "none" });
    });
  }
}

async function drawWithBrowser(backgroundColor: string, rasterizeSvg: RasterizeSvg): Promise<string> {
  const { domToPng } = await import("modern-screenshot");
  const pictures = await paintPictureSvgs(rasterizeSvg);
  const layout = markLayout();
  try {
    return await domToPng(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      backgroundColor,
      timeout: 4_000,
      filter: (node) => !(node instanceof Element && node.hasAttribute("data-feedback-screenshot-ignore")),
      onCloneNode: (root) => { if (root instanceof Element) prepareCopy(root, layout.page, pictures.images); },
    });
  } finally {
    layout.clear();
    pictures.clear();
  }
}

export async function captureAppScreen({ isBlank = looksBlank, rasterizeSvg = paintSvg }: {
  isBlank?: (dataUrl: string) => Promise<boolean>;
  rasterizeSvg?: RasterizeSvg;
} = {}): Promise<{ dataUrl: string }> {
  const sourceCanvases = Array.from(document.querySelectorAll("canvas"));
  const bitmaps = sourceCanvases.map((source) => {
    const rect = source.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.right <= 0 || rect.bottom <= 0
      || rect.left >= window.innerWidth || rect.top >= window.innerHeight
      || source.closest("[data-feedback-screenshot-ignore]")) return null;
    try {
      return source.toDataURL("image/png");
    } catch {
      throw new Error("Canvas-Inhalt konnte nicht sicher erfasst werden. Bitte wähle einen echten Screenshot aus.");
    }
  });

  const backgroundColor = pageBackground();
  try {
    const drawn = await drawWithBrowser(backgroundColor, rasterizeSvg);
    if (drawn.startsWith("data:image/png;base64,") && !(await isBlank(drawn))) return checked(drawn);
  } catch {
    // Browser renderer unavailable (e.g. foreignObject blocked): rebuild instead.
  }

  const { default: html2canvas } = await import("html2canvas-pro");
  const canvas = await html2canvas(document.documentElement, {
    backgroundColor,
    useCORS: true,
    allowTaint: false,
    scale: 1,
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    ignoreElements: (element) => element.hasAttribute("data-feedback-screenshot-ignore"),
    onclone: (clonedDocument) => {
      Array.from(clonedDocument.querySelectorAll("canvas")).forEach((clonedCanvas, index) => {
        const bitmap = bitmaps[index];
        if (!bitmap) return;
        const image = clonedDocument.createElement("img");
        image.src = bitmap;
        image.width = clonedCanvas.width;
        image.height = clonedCanvas.height;
        image.style.cssText = clonedCanvas.style.cssText;
        image.className = clonedCanvas.className;
        clonedCanvas.replaceWith(image);
      });
      clonedDocument.querySelectorAll<HTMLInputElement>("input[type=password], input[autocomplete=current-password], input[autocomplete=one-time-code]")
        .forEach((input) => { input.value = ""; input.setAttribute("value", ""); });
      clonedDocument.querySelectorAll<HTMLElement>("[data-pointout-private]")
        .forEach((element) => { element.style.visibility = "hidden"; });
    },
  });
  return checked(canvas.toDataURL("image/png"));
}

function checked(dataUrl: string): { dataUrl: string } {
  if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 8_000_000) {
    throw new Error("Screenshot konnte nicht gespeichert werden. Bitte wähle ein Bild aus.");
  }
  return { dataUrl };
}

export async function readManualScreenshot(file: File): Promise<string> {
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("Bitte wähle einen Screenshot oder ein Bild aus.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Das Bild ist zu groß (maximal 20 MB).");
  if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
    const source = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Das Bildformat konnte nicht geöffnet werden. Bitte wähle einen PNG- oder JPEG-Screenshot aus."));
        image.src = source;
      });
      for (const size of [1600, 1200, 900]) {
        const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Dieses Gerät kann das Bild nicht verarbeiten.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        if (dataUrl.length <= 8_000_000) return dataUrl;
      }
      throw new Error("Das Bild ist nach der Verkleinerung noch zu groß.");
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

export async function flattenAnnotations(dataUrl: string, marks: AnnotationMark[]): Promise<string> {
  if (marks.length === 0) return dataUrl;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Das markierte Bild konnte nicht verarbeitet werden."));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Bildverarbeitung wird von diesem Browser nicht unterstützt.");
  context.drawImage(image, 0, 0);
  drawMarks(context, marks, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
