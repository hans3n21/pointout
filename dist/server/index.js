// src/server/index.ts
import OpenAI from "openai";
import { createHmac } from "crypto";
var MAX_JSON_BYTES = 85e5;
var MAX_IMAGE_BYTES = 6 * 1024 * 1024;
var MAX_AUDIO_BYTES = 10 * 1024 * 1024;
var AUDIO_TYPES = /* @__PURE__ */ new Set(["audio/m4a", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/x-m4a", "audio/x-wav"]);
function json(body, status) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
async function readLimitedBytes(request, maxBytes) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
async function readLimited(request, maxBytes) {
  const bytes = await readLimitedBytes(request, maxBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
function recordOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function shortText(value, max = 120) {
  return typeof value === "string" && value.length <= max ? value : null;
}
function size(value) {
  const item = recordOf(value);
  return typeof item.width === "number" && Number.isFinite(item.width) && item.width > 0 && item.width <= 1e5 && typeof item.height === "number" && Number.isFinite(item.height) && item.height > 0 && item.height <= 1e5 ? { width: item.width, height: item.height } : null;
}
function safeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : null;
  } catch {
    return null;
  }
}
function marksOf(value) {
  const input = recordOf(value);
  if (input.version !== 1 || !Array.isArray(input.marks) || input.marks.length > 100) return null;
  const marks = [];
  for (const raw of input.marks) {
    const mark = recordOf(raw);
    if (!["freehand", "rectangle", "circle", "arrow"].includes(String(mark.tool)) || !Array.isArray(mark.points) || mark.points.length < 1 || mark.points.length > 2e3) return null;
    const points = [];
    for (const rawPoint of mark.points) {
      const point = recordOf(rawPoint);
      if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
      points.push({ x: point.x, y: point.y });
    }
    marks.push({ tool: String(mark.tool), points });
  }
  return { version: 1, marks };
}
function imageOf(value) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 8e6) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return false;
  const mime = `image/${match[1]}`;
  const signature = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  return signature ? { bytes, mime, extension: match[1] === "jpeg" ? "jpg" : match[1] } : false;
}
function parseFeedback(raw, projectId) {
  const data = recordOf(raw);
  if (data.project_id !== projectId || typeof data.note !== "string" || !data.note.trim() || data.note.length > 4e3) return null;
  const image = imageOf(data.screenshot_base64);
  const annotations = marksOf(data.annotation_data);
  if (image === false || !annotations) return null;
  const context = recordOf(data.device_context);
  const metadata = recordOf(data.metadata);
  const deviceType = context.device_type;
  const displayMode = context.display_mode;
  const captureSource = metadata.capture_source;
  return { image, record: {
    id: crypto.randomUUID(),
    project_id: projectId,
    feedback_text: data.note.trim(),
    transcript_original: shortText(data.transcript_original, 4e3),
    annotation_data: annotations,
    page_url: safeUrl(context.page_url),
    route: shortText(context.route, 2048),
    browser: shortText(context.browser),
    browser_version: shortText(context.browser_version),
    operating_system: shortText(context.operating_system),
    operating_system_version: shortText(context.operating_system_version),
    device_type: deviceType === "mobile" || deviceType === "tablet" || deviceType === "desktop" ? deviceType : null,
    viewport: size(context.viewport),
    screen_size: size(context.screen_size),
    pixel_ratio: typeof context.pixel_ratio === "number" && context.pixel_ratio > 0 && context.pixel_ratio <= 16 ? context.pixel_ratio : null,
    touch_enabled: typeof context.touch_enabled === "boolean" ? context.touch_enabled : null,
    display_mode: displayMode === "standalone" || displayMode === "browser" ? displayMode : null,
    app_version: shortText(data.app_version),
    metadata: captureSource === "automatic" || captureSource === "manual" ? { capture_source: captureSource } : {}
  } };
}
function createPointOutHandlers(options) {
  if (!options.projectId || !options.store || !options.rateLimit || !options.transcribe) throw new Error("PointOut server configuration is incomplete.");
  return {
    feedback: async (request) => {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON erforderlich." }, 415);
      let allowed;
      try {
        allowed = await options.rateLimit(request, "feedback");
      } catch {
        return json({ error: "Feedback ist gerade nicht verf\xFCgbar." }, 503);
      }
      if (!allowed) return json({ error: "Bitte warte kurz." }, 429);
      const body = await readLimited(request, MAX_JSON_BYTES);
      if (body === null) return json({ error: "Feedback ist zu gro\xDF." }, 413);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json({ error: "Ung\xFCltiges Feedback." }, 400);
      }
      const feedback = parseFeedback(parsed, options.projectId);
      if (!feedback) return json({ error: "Ung\xFCltiges Feedback." }, 400);
      try {
        await options.store.save(feedback.record, feedback.image);
      } catch {
        return json({ error: "Feedback konnte nicht gespeichert werden." }, 503);
      }
      return Response.json({ id: feedback.record.id, ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
    },
    transcribe: async (request) => {
      if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return json({ error: "Audio muss als Datei gesendet werden." }, 415);
      let allowed;
      try {
        allowed = await options.rateLimit(request, "transcribe");
      } catch {
        return json({ error: "Spracheingabe ist gerade nicht verf\xFCgbar." }, 503);
      }
      if (!allowed) return json({ error: "Bitte warte kurz." }, 429);
      const length = Number(request.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_AUDIO_BYTES + 256 * 1024) return json({ error: "Audio ist zu gro\xDF." }, 413);
      const bytes = await readLimitedBytes(request, MAX_AUDIO_BYTES + 256 * 1024);
      if (bytes === null) return json({ error: "Audio ist zu gro\xDF." }, 413);
      let audio;
      try {
        const bounded = new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: new Uint8Array(bytes).buffer });
        audio = (await bounded.formData()).get("audio");
      } catch {
        return json({ error: "Ung\xFCltige Audiodatei." }, 400);
      }
      if (!(audio instanceof File) || !audio.size || audio.size > MAX_AUDIO_BYTES) return json({ error: "Ung\xFCltige Audiodatei." }, 400);
      if (!AUDIO_TYPES.has(audio.type.split(";", 1)[0].toLowerCase())) return json({ error: "Audioformat wird nicht unterst\xFCtzt." }, 415);
      try {
        const text = (await options.transcribe(audio)).trim();
        return text ? Response.json({ text }, { headers: { "Cache-Control": "no-store" } }) : json({ error: "Keine Sprache erkannt." }, 422);
      } catch {
        return json({ error: "Transkription fehlgeschlagen. Bitte Text eingeben." }, 503);
      }
    }
  };
}
function createOpenAITranscriber(apiKey, model = "gpt-4o-mini-transcribe") {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required on the server.");
  const client = new OpenAI({ apiKey });
  return async (audio) => {
    const result = await client.audio.transcriptions.create({ file: audio, model, language: "de", prompt: "Transkribiere nur h\xF6rbare Sprache. Erfinde keinen Inhalt bei Stille." });
    return result.text;
  };
}
function createSupabaseStore(client, bucket = "pointout-feedback") {
  return { async save(record, image) {
    const path = image ? `${record.project_id}/${record.id}.${image.extension}` : null;
    if (path && image) {
      const upload = await client.storage.from(bucket).upload(path, image.bytes, { contentType: image.mime, upsert: false });
      if (upload.error) throw upload.error;
    }
    const insert = await client.from("pointout_feedback").insert({ ...record, screenshot_url: path, status: "new" });
    if (insert.error) {
      if (path) await client.storage.from(bucket).remove([path]);
      throw insert.error;
    }
  } };
}
function createSupabaseRateLimiter(client, options) {
  if (!options.projectId || options.secret.length < 16) throw new Error("PointOut rate limit requires a project ID and a server-only secret of at least 16 characters.");
  return async (request, operation) => {
    const identity = await options.identify(request);
    if (!identity) return false;
    const keyHash = createHmac("sha256", options.secret).update(options.projectId).update("\0").update(identity).digest("hex");
    const { data, error } = await client.rpc("pointout_claim_request", {
      p_project_id: options.projectId,
      p_scope: operation,
      p_key_hash: keyHash,
      p_window_seconds: 3600,
      p_limit: operation === "feedback" ? options.feedbackPerHour ?? 12 : options.transcriptionsPerHour ?? 20
    });
    if (error) throw error;
    return data === true;
  };
}
export {
  createOpenAITranscriber,
  createPointOutHandlers,
  createSupabaseRateLimiter,
  createSupabaseStore
};
