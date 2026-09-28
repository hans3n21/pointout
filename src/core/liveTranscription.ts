export type LiveTranscription = {
  /** Resolves true once the live connection is open; false when the host has none. */
  ready: Promise<boolean>;
  /** Commits the recording and resolves with the final text, or null to fall back to the upload. */
  finish: () => Promise<string | null>;
  cancel: () => void;
};

/**
 * One microphone recording = one committed transcription turn over WebRTC.
 * The host's server only relays the SDP offer (see `transcribeLive` in the
 * server adapter); the API key never reaches the browser. Words arrive while
 * speaking, so the final text is there right after stopping.
 */
export function startLiveTranscription(stream: MediaStream, onText: (text: string) => void, url: string): LiveTranscription {
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("transcription");
  const abort = new AbortController();
  let closed = false;
  let finishing = false;
  let finalText: string | null = null;
  let partial = "";
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveFinish: ((text: string | null) => void) | undefined;
  let finishPromise: Promise<string | null> | undefined;
  let resolveOpen: ((open: boolean) => void) | undefined;
  const opened = new Promise<boolean>((resolve) => { resolveOpen = resolve; });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(commitTimer);
    clearTimeout(finishTimer);
    clearTimeout(setupTimer);
    abort.abort();
    channel.onmessage = null;
    channel.onclose = null;
    peer.onconnectionstatechange = null;
    channel.close();
    peer.close();
    resolveOpen?.(false);
    resolveFinish?.(finalText);
  };
  const setupTimer = setTimeout(close, 10_000);
  channel.onopen = () => resolveOpen?.(true);
  channel.onclose = close;
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") close();
  };
  channel.onmessage = (message) => {
    if (closed) return;
    let event: { type?: string; delta?: string; transcript?: string };
    try { event = JSON.parse(message.data); } catch { return; }
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") {
      close();
    } else if (event.type === "conversation.item.input_audio_transcription.delta" && typeof event.delta === "string") {
      partial += event.delta;
      onText(partial);
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
      finalText = event.transcript.trim();
      onText(finalText);
      if (finishing) close();
    }
  };

  const ready = (async () => {
    try {
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const offer = await peer.createOffer();
      if (closed) return false;
      await peer.setLocalDescription(offer);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
        signal: abort.signal,
      });
      if (!response.ok) throw new Error("Live transcription unavailable");
      const sdp = await response.text();
      if (closed) return false;
      await peer.setRemoteDescription({ type: "answer", sdp });
      const connected = channel.readyState === "open" || await opened;
      if (connected && !closed) clearTimeout(setupTimer);
      return connected && !closed;
    } catch {
      close();
      return false;
    }
  })();

  return {
    ready,
    cancel: close,
    finish() {
      if (finishPromise) return finishPromise;
      if (closed) return Promise.resolve(null);
      finishing = true;
      finishPromise = new Promise<string | null>((resolve) => { resolveFinish = resolve; });
      // Let the last audio packets arrive before committing the turn.
      commitTimer = setTimeout(() => {
        if (closed) return;
        if (channel.readyState !== "open") { close(); return; }
        channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }, 300);
      finishTimer = setTimeout(close, 12_000);
      if (finalText !== null) close();
      return finishPromise;
    },
  };
}
