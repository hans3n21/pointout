import { beforeEach, describe, expect, it, vi } from "vitest";
import html2canvas from "html2canvas-pro";
import { domToPng, type Options as RendererOptions } from "modern-screenshot";
import { captureAppScreen, isUniformImage, readManualScreenshot } from "../capture";

vi.mock("html2canvas-pro", () => ({ default: vi.fn() }));
vi.mock("modern-screenshot", () => ({ domToPng: vi.fn() }));

const BROWSER_SHOT = "data:image/png;base64,YnJvd3Nlcg==";
const FALLBACK_SHOT = "data:image/png;base64,c2NyZWVu";

// domToPng is overloaded; the tests only use the (node, options) form.
const renderer = vi.mocked(domToPng as unknown as (node: Node, options?: RendererOptions) => Promise<string>);

function cloneOfPage(): HTMLElement {
  const cloned = document.implementation.createHTMLDocument();
  cloned.documentElement.innerHTML = document.documentElement.innerHTML;
  return cloned.documentElement;
}

function scrolled(element: HTMLElement, top: number, left = 0) {
  Object.defineProperty(element, "scrollTop", { configurable: true, value: top });
  Object.defineProperty(element, "scrollLeft", { configurable: true, value: left });
}

describe("PointOut capture", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    vi.mocked(html2canvas).mockReset();
    renderer.mockReset();
  });

  it("lets the browser draw the visible screen first, without PointOut's own controls", async () => {
    renderer.mockResolvedValue(BROWSER_SHOT);
    document.body.style.backgroundColor = "rgb(250, 250, 250)";
    const result = await captureAppScreen({ isBlank: async () => false });
    expect(result.dataUrl).toBe(BROWSER_SHOT);
    expect(html2canvas).not.toHaveBeenCalled();
    const [node, options] = renderer.mock.calls[0] as [Node, RendererOptions];
    expect(node).toBe(document.documentElement);
    expect(options).toMatchObject({ width: window.innerWidth, height: window.innerHeight, scale: 1, backgroundColor: "rgb(250, 250, 250)" });
    const trigger = document.createElement("button");
    trigger.setAttribute("data-feedback-screenshot-ignore", "");
    expect(options.filter?.(trigger)).toBe(false);
    expect(options.filter?.(document.createElement("div"))).toBe(true);
  });

  it("hides private areas and password values in the copy it draws", async () => {
    document.body.innerHTML = `<div data-pointout-private>Kontonummer</div><input type="password" value="geheim">`;
    let copy: HTMLElement | null = null;
    renderer.mockImplementation(async (_node, options) => {
      copy = cloneOfPage();
      await (options as RendererOptions).onCloneNode?.(copy);
      return BROWSER_SHOT;
    });
    await captureAppScreen({ isBlank: async () => false });
    expect(copy!.querySelector<HTMLElement>("[data-pointout-private]")!.style.visibility).toBe("hidden");
    expect(copy!.querySelector<HTMLInputElement>("input")!.getAttribute("value")).toBe("");
  });

  it("shows scrolled panels at their scroll position, not at the top", async () => {
    document.body.innerHTML = `<main id="list"><div id="a">A</div><div id="b" style="transform: rotate(1deg)">B</div></main>`;
    scrolled(document.getElementById("list")!, 700, 20);
    let copy: HTMLElement | null = null;
    renderer.mockImplementation(async (_node, options) => {
      copy = cloneOfPage();
      await (options as RendererOptions).onCloneNode?.(copy);
      return BROWSER_SHOT;
    });
    await captureAppScreen({ isBlank: async () => false });
    expect(copy!.querySelector<HTMLElement>("#a")!.style.transform).toBe("translate(-20px, -700px)");
    expect(copy!.querySelector<HTMLElement>("#b")!.style.transform).toBe("translate(-20px, -700px) rotate(1deg)");
    // The shifted copy needs no scrollbars; their gutters would clip the content.
    expect(copy!.querySelector<HTMLElement>("#list")!.style.overflow).toBe("hidden");
    expect(document.querySelector("[data-pointout-scroll]")).toBeNull();
  });

  it("keeps fixed bars in place when the whole page is scrolled", async () => {
    document.body.innerHTML = `<header id="bar" style="position: fixed; bottom: 0">Leiste</header><p>Text</p>`;
    scrolled(document.documentElement, 600);
    const bar = document.getElementById("bar")!;
    bar.getBoundingClientRect = () => ({ top: 740, left: 0, width: 800, height: 60 } as DOMRect);
    document.body.getBoundingClientRect = () => ({ top: -600, left: 0, width: 800, height: 4000 } as DOMRect);
    let copy: HTMLElement | null = null;
    renderer.mockImplementation(async (_node, options) => {
      copy = cloneOfPage();
      await (options as RendererOptions).onCloneNode?.(copy);
      return BROWSER_SHOT;
    });
    await captureAppScreen({ isBlank: async () => false });
    const copiedBar = copy!.querySelector<HTMLElement>("#bar")!;
    expect(copiedBar.style).toMatchObject({ top: "1340px", left: "0px", bottom: "auto", width: "800px", height: "60px" });
    expect(copy!.querySelector<HTMLElement>("body")!.style.transform).toBe("translate(0px, -600px)");
  });

  it("paints SVGs that use pictures (masks, patterns) in advance, because Safari drops them", async () => {
    document.body.innerHTML = `
      <svg id="shirt" width="120" height="120"><mask id="m"><image href="mask.png" width="120" height="120"/></mask><rect width="120" height="120" fill="#eee" mask="url(#m)"/></svg>
      <svg id="icon" width="20" height="20"><path d="M0 0h20v20z"/></svg>`;
    document.getElementById("shirt")!.getBoundingClientRect = () => ({ top: 10, left: 10, right: 130, bottom: 130, width: 120, height: 120 } as DOMRect);
    document.getElementById("icon")!.getBoundingClientRect = () => ({ top: 10, left: 200, right: 220, bottom: 30, width: 20, height: 20 } as DOMRect);
    const rasterizeSvg = vi.fn(async () => "data:image/png;base64,c2hpcnQ=");
    let copy: HTMLElement | null = null;
    renderer.mockImplementation(async (_node, options) => {
      copy = cloneOfPage();
      await (options as RendererOptions).onCloneNode?.(copy);
      return BROWSER_SHOT;
    });
    await captureAppScreen({ isBlank: async () => false, rasterizeSvg });
    expect(rasterizeSvg).toHaveBeenCalledOnce();
    expect(copy!.querySelector("#shirt")).toBeNull();
    const painted = copy!.querySelector("img")!;
    expect(painted.getAttribute("src")).toBe("data:image/png;base64,c2hpcnQ=");
    expect(painted.style).toMatchObject({ width: "120px", height: "120px" });
    expect(copy!.querySelector("#icon")).not.toBeNull();
    expect(document.querySelector("[data-pointout-raster]")).toBeNull();
  });

  it("keeps the live SVG when painting it in advance fails", async () => {
    document.body.innerHTML = `<svg id="shirt" width="120" height="120"><image href="x.png" width="120" height="120"/></svg>`;
    document.getElementById("shirt")!.getBoundingClientRect = () => ({ top: 10, left: 10, right: 130, bottom: 130, width: 120, height: 120 } as DOMRect);
    let copy: HTMLElement | null = null;
    renderer.mockImplementation(async (_node, options) => {
      copy = cloneOfPage();
      await (options as RendererOptions).onCloneNode?.(copy);
      return BROWSER_SHOT;
    });
    await captureAppScreen({ isBlank: async () => false, rasterizeSvg: async () => { throw new Error("CORS"); } });
    expect(copy!.querySelector("#shirt")).not.toBeNull();
  });

  it("falls back to the rebuilt screenshot when the browser renderer fails", async () => {
    renderer.mockRejectedValue(new Error("foreignObject not supported"));
    vi.mocked(html2canvas).mockResolvedValue({ toDataURL: () => FALLBACK_SHOT } as HTMLCanvasElement);
    document.body.innerHTML = `<main id="list"><div>A</div></main>`;
    scrolled(document.getElementById("list")!, 300);
    expect((await captureAppScreen({ isBlank: async () => false })).dataUrl).toBe(FALLBACK_SHOT);
    expect(document.querySelector("[data-pointout-scroll]")).toBeNull();
  });

  it("falls back when the browser renderer hands back a blank picture", async () => {
    renderer.mockResolvedValue(BROWSER_SHOT);
    vi.mocked(html2canvas).mockResolvedValue({ toDataURL: () => FALLBACK_SHOT } as HTMLCanvasElement);
    expect((await captureAppScreen({ isBlank: async (dataUrl) => dataUrl === BROWSER_SHOT })).dataUrl).toBe(FALLBACK_SHOT);
  });

  it("copies a readable app canvas into the fallback clone", async () => {
    renderer.mockRejectedValue(new Error("no renderer"));
    const source = document.createElement("canvas");
    source.width = 100;
    source.height = 50;
    source.getBoundingClientRect = () => ({ width: 100, height: 50, top: 0, left: 0 } as DOMRect);
    source.toDataURL = vi.fn(() => "data:image/png;base64,YWJj");
    document.body.append(source);
    vi.mocked(html2canvas).mockImplementation(async (_node, options) => {
      const clonedDocument = document.implementation.createHTMLDocument();
      clonedDocument.documentElement.innerHTML = document.documentElement.innerHTML;
      const clone = clonedDocument.documentElement;
      await options?.onclone?.(clonedDocument, clone);
      expect(clone.querySelector("canvas")).toBeNull();
      expect(clone.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,YWJj");
      return { toDataURL: () => FALLBACK_SHOT } as HTMLCanvasElement;
    });
    expect((await captureAppScreen({ isBlank: async () => false })).dataUrl).toBe(FALLBACK_SHOT);
  });

  it("reports unreadable canvas content instead of silently saving a blank editor", async () => {
    const source = document.createElement("canvas");
    source.width = 100;
    source.height = 50;
    source.getBoundingClientRect = () => ({ width: 100, height: 50, top: 0, left: 0 } as DOMRect);
    source.toDataURL = vi.fn(() => { throw new DOMException("Tainted", "SecurityError"); });
    document.body.append(source);
    await expect(captureAppScreen({ isBlank: async () => false })).rejects.toThrow("Canvas-Inhalt");
    expect(domToPng).not.toHaveBeenCalled();
    expect(html2canvas).not.toHaveBeenCalled();
  });

  it("accepts a selected PNG screenshot and rejects unrelated files", async () => {
    const file = new File(["image"], "screen.png", { type: "image/png" });
    await expect(readManualScreenshot(file)).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(readManualScreenshot(new File(["plain"], "notes.txt", { type: "text/plain" })))
      .rejects.toThrow("Screenshot oder ein Bild");
  });
});

describe("isUniformImage", () => {
  it("recognises a picture that is one flat colour", () => {
    const flat = new Uint8ClampedArray(4 * 100).fill(200);
    expect(isUniformImage(flat)).toBe(true);
  });

  it("does not mistake a real screen for a blank one", () => {
    const pixels = new Uint8ClampedArray(4 * 100).fill(30);
    pixels.set([240, 240, 240, 255], 4 * 57);
    expect(isUniformImage(pixels)).toBe(false);
  });
});
