import { afterEach, describe, expect, it, vi } from "vitest";
import { startLiveTranscription } from "../liveTranscription";

const URL = "/api/pointout/transcribe/live";

function transport() {
  const channel = {
    readyState: "open", onmessage: null as null | ((event: { data: string }) => void),
    onopen: null as null | (() => void), onclose: null as null | (() => void),
    send: vi.fn(), close: vi.fn(),
  };
  const peer = {
    connectionState: "connected", onconnectionstatechange: null,
    addTrack: vi.fn(), createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: "v=0\r\no=offer" }),
    setLocalDescription: vi.fn(), setRemoteDescription: vi.fn(), close: vi.fn(),
  };
  vi.stubGlobal("RTCPeerConnection", class { constructor() { return peer; } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("v=0\r\no=answer")));
  return { channel, peer, emit: (event: object) => channel.onmessage?.({ data: JSON.stringify(event) }) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("live dictation", () => {
  it("commits once and falls back within a bounded wait when final text never arrives", async () => {
    vi.useFakeTimers();
    const { channel, peer } = transport();
    const live = startLiveTranscription({ getAudioTracks: () => [] } as unknown as MediaStream, vi.fn(), URL);
    await live.ready;
    const finishing = live.finish();
    expect(live.finish()).toBe(finishing);
    await vi.advanceTimersByTimeAsync(300);
    expect(channel.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(finishing).resolves.toBe(null);
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it("publishes partial words before stopping, then replaces them with the final text", async () => {
    const { channel, peer, emit } = transport();
    const onText = vi.fn();
    const stream = { getAudioTracks: () => [{ enabled: true }] } as unknown as MediaStream;
    const live = startLiveTranscription(stream, onText, URL);
    await live.ready;
    emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "one", delta: "Ein blau" });
    expect(onText).toHaveBeenLastCalledWith("Ein blau");
    emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "one", delta: "es Shirt" });
    expect(onText).toHaveBeenLastCalledWith("Ein blaues Shirt");
    const result = live.finish();
    // Completion may arrive before the final drain/commit timer fires.
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "one", transcript: "Ein blaues Shirt." });
    await expect(result).resolves.toBe("Ein blaues Shirt.");
    expect(peer.close).toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalled();
  });

  it("closes on setup failure and reports fallback instead of losing the recording", async () => {
    const { peer } = transport();
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const live = startLiveTranscription({ getAudioTracks: () => [] } as unknown as MediaStream, vi.fn(), URL);
    await expect(live.ready).resolves.toBe(false);
    await expect(live.finish()).resolves.toBe(null);
    expect(peer.close).toHaveBeenCalled();
  });

  it("sends the offer as SDP to the host's live route", async () => {
    transport();
    const live = startLiveTranscription({ getAudioTracks: () => [] } as unknown as MediaStream, vi.fn(), URL);
    await live.ready;
    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/sdp" }, body: "v=0\r\no=offer" }));
    live.cancel();
  });

  it("reports no live connection when the host has no live route", async () => {
    const { peer } = transport();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const live = startLiveTranscription({ getAudioTracks: () => [] } as unknown as MediaStream, vi.fn(), URL);
    await expect(live.ready).resolves.toBe(false);
    expect(peer.close).toHaveBeenCalled();
  });

  it("ignores late events after disposal", async () => {
    const { emit } = transport();
    const onText = vi.fn();
    const live = startLiveTranscription({ getAudioTracks: () => [] } as unknown as MediaStream, onText, URL);
    await live.ready;
    live.cancel();
    emit({ type: "conversation.item.input_audio_transcription.delta", delta: "spät" });
    expect(onText).not.toHaveBeenCalled();
    await expect(live.finish()).resolves.toBe(null);
  });
});
