import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PointOutWidget } from "../PointOutWidget";
import { captureAppScreen } from "../../core/capture";

vi.mock("../../core/capture", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../core/capture")>();
  return { ...original, captureAppScreen: vi.fn(), flattenAnnotations: vi.fn(async (image: string) => image) };
});
vi.mock("../useDictation", () => ({
  useDictation: () => ({ phase: "idle", error: "", start: vi.fn(), stop: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); document.body.innerHTML = ""; });

describe("PointOutWidget", () => {
  it("captures before opening its overlay", async () => {
    let complete!: (value: { dataUrl: string }) => void;
    vi.mocked(captureAppScreen).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<PointOutWidget projectId="sample" projectName="Sample" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback geben" }));
    expect(captureAppScreen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    complete({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dQAAAABJRU5ErkJggg==" });
    expect(await screen.findByRole("dialog", { name: "Feedback geben" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Screenshot für dein Feedback" })).toBeTruthy();
  });

  it("keeps text and image after a network failure and resumes the draft", async () => {
    vi.mocked(captureAppScreen).mockResolvedValue({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dQAAAABJRU5ErkJggg==" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<PointOutWidget projectId="sample" projectName="Sample" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback geben" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback-Text" }), { target: { value: "Fehler beim Speichern" } });
    fireEvent.click(screen.getByRole("button", { name: /Feedback senden/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Entwurf bleibt erhalten"));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Feedback-Text" }).value).toBe("Fehler beim Speichern");
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.click(screen.getByRole("button", { name: "Feedback geben" }));
    expect(screen.getByText(/Ungesendeter Entwurf/)).toBeTruthy();
    expect(captureAppScreen).toHaveBeenCalledOnce();
  });

  it("refreshes an automatic screenshot when reopening and keeps typed text", async () => {
    vi.mocked(captureAppScreen)
      .mockResolvedValueOnce({ dataUrl: "data:image/png;base64,Zmlyc3Q=" })
      .mockResolvedValueOnce({ dataUrl: "data:image/png;base64,c2Vjb25k" });
    render(<PointOutWidget projectId="sample" projectName="Sample" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback geben" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback-Text" }), { target: { value: "Mein Entwurf" } });
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.click(screen.getByRole("button", { name: "Feedback geben" }));
    await waitFor(() => expect(captureAppScreen).toHaveBeenCalledTimes(2));
    await screen.findByRole("dialog");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Feedback-Text" }).value).toBe("Mein Entwurf");
    expect(screen.getByRole("img", { name: "Screenshot für dein Feedback" }).getAttribute("src")).toContain("c2Vjb25k");
  });
});
