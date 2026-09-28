import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDictation } from "../useDictation";
import { startLiveTranscription } from "../../core/liveTranscription";

vi.mock("../../core/liveTranscription", () => ({ startLiveTranscription: vi.fn() }));

class Recorder {
  static isTypeSupported = () => true;
  state = "inactive"; mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["ton"], { type: "audio/webm" }) }); this.onstop?.(); }
}

beforeEach(() => {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) } });
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("RTCPeerConnection", class {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("useDictation", () => {
  it("shows the words while speaking and hands over the final text at stop, without an upload", async () => {
    let speak!: (text: string) => void;
    const finish = vi.fn(async () => "Der Ton bricht ab.");
    vi.mocked(startLiveTranscription).mockImplementation((_stream, onText, url) => {
      expect(url).toBe("/live");
      speak = onText;
      return { ready: Promise.resolve(true), finish, cancel: vi.fn() };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(onText, "/upload", "/live"));
    await act(() => result.current.start());
    expect(result.current.phase).toBe("recording");
    act(() => speak("Der Ton"));
    expect(result.current.liveText).toBe("Der Ton");
    act(() => result.current.stop());
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Der Ton bricht ab."));
    expect(result.current.phase).toBe("idle");
    expect(result.current.liveText).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads the recording when the host has no live route", async () => {
    vi.mocked(startLiveTranscription).mockReturnValue({ ready: Promise.resolve(false), finish: async () => null, cancel: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ text: "Hochgeladen" }));
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(onText, "/upload", "/live"));
    await act(() => result.current.start());
    act(() => result.current.stop());
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Hochgeladen"));
    expect(fetchMock).toHaveBeenCalledWith("/upload", expect.objectContaining({ method: "POST" }));
  });

  it("does not try a live connection when it is switched off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ text: "Nur Upload" })));
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(onText, "/upload", null));
    await act(() => result.current.start());
    act(() => result.current.stop());
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Nur Upload"));
    expect(startLiveTranscription).not.toHaveBeenCalled();
  });
});
