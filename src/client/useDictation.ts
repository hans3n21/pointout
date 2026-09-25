"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { audioFileExtension, getVoiceErrorMessage, selectVoiceMimeType } from "../core/recording";

export type DictationPhase = "idle" | "recording" | "transcribing";

const TRANSCRIPTION_FAILED = "Die Aufnahme konnte nicht in Text umgewandelt werden. Bitte versuche es erneut.";

/** Schlichtes Diktat: aufnehmen, beim Beenden umwandeln, Text zurückgeben. Für Felder
 * ohne Live-Mitschrift wie das Feedback; das Eingabefeld der Bühne hat seine eigene. */
export function useDictation(onText: (text: string) => void, transcribeUrl: string) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Wer geht, nimmt das Mikrofon nicht mit.
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    release();
  }, [release]);

  const transcribe = async (audio: Blob) => {
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", audio, `feedback.${audioFileExtension(audio.type || "audio/webm")}`);
      const response = await fetch(transcribeUrl, { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok || !data.text?.trim()) throw new Error(data.error ?? TRANSCRIPTION_FAILED);
      onTextRef.current(data.text.trim());
    } catch {
      setError(TRANSCRIPTION_FAILED);
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    if (phase !== "idle") return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Spracheingabe wird von diesem Browser nicht unterstützt. Nutze alternativ die Diktierfunktion deiner Handy-Tastatur.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = selectVoiceMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = () => {
        release();
        recorderRef.current = null;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (audio.size === 0) {
          setPhase("idle");
          setError("Ich habe keine Aufnahme erhalten. Bitte versuche es erneut.");
          return;
        }
        void transcribe(audio);
      };
      recorder.onerror = () => {
        release();
        recorderRef.current = null;
        setPhase("idle");
        setError("Die Aufnahme ist abgebrochen. Bitte versuche es erneut.");
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
    } catch (cause) {
      release();
      setPhase("idle");
      setError(getVoiceErrorMessage(cause));
    }
  };

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  return { phase, error, start, stop };
}
