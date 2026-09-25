import { beforeEach, describe, expect, it, vi } from "vitest";
import html2canvas from "html2canvas-pro";
import { captureAppScreen, readManualScreenshot } from "../capture";

vi.mock("html2canvas-pro", () => ({ default: vi.fn() }));

describe("PointOut capture", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(html2canvas).mockReset();
  });

  it("copies a readable app canvas into the screenshot clone", async () => {
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
      return { toDataURL: () => "data:image/png;base64,c2NyZWVu" } as HTMLCanvasElement;
    });
    expect((await captureAppScreen()).dataUrl).toContain("c2NyZWVu");
  });

  it("uses the app background instead of forcing a dark screenshot", async () => {
    document.body.style.backgroundColor = "rgb(250, 250, 250)";
    vi.mocked(html2canvas).mockResolvedValue({ toDataURL: () => "data:image/png;base64,c2NyZWVu" } as HTMLCanvasElement);
    await captureAppScreen();
    expect(vi.mocked(html2canvas).mock.calls[0][1]?.backgroundColor).toBe("rgb(250, 250, 250)");
    document.body.style.backgroundColor = "";
  });

  it("reports unreadable canvas content instead of silently saving a blank editor", async () => {
    const source = document.createElement("canvas");
    source.width = 100;
    source.height = 50;
    source.getBoundingClientRect = () => ({ width: 100, height: 50, top: 0, left: 0 } as DOMRect);
    source.toDataURL = vi.fn(() => { throw new DOMException("Tainted", "SecurityError"); });
    document.body.append(source);
    await expect(captureAppScreen()).rejects.toThrow("Canvas-Inhalt");
    expect(html2canvas).not.toHaveBeenCalled();
  });

  it("accepts a selected PNG screenshot and rejects unrelated files", async () => {
    const file = new File(["image"], "screen.png", { type: "image/png" });
    await expect(readManualScreenshot(file)).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(readManualScreenshot(new File(["plain"], "notes.txt", { type: "text/plain" })))
      .rejects.toThrow("Screenshot oder ein Bild");
  });
});
