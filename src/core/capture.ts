import { drawMarks, type AnnotationMark } from "./annotation";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function captureAppScreen(): Promise<{ dataUrl: string }> {
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

  const { default: html2canvas } = await import("html2canvas-pro");
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  const rootBackground = getComputedStyle(document.documentElement).backgroundColor;
  const backgroundColor = [bodyBackground, rootBackground].find((color) =>
    color && color !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/.test(color)
  ) ?? "#ffffff";
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
  const dataUrl = canvas.toDataURL("image/png");
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
