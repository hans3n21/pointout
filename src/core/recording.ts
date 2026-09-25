/** Gemeinsame Bausteine für Sprachaufnahmen (Eingabefeld der Bühne, Feedback). */

export const VOICE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

export function selectVoiceMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function audioFileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export function getVoiceErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Mikrofonzugriff wurde blockiert. Bitte erlaube das Mikrofon im Browser oder nutze die Diktierfunktion deiner Handy-Tastatur.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Kein Mikrofon gefunden. Prüfe die Mikrofonfreigabe oder nutze die Tastatur-Diktierfunktion.";
  }
  return "Spracheingabe ist auf diesem Gerät gerade nicht verfügbar. Nutze alternativ die Diktierfunktion deiner Handy-Tastatur.";
}
