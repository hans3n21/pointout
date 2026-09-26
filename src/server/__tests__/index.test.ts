// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOpenAITranscriber, createPointOutHandlers, createSupabaseStore } from "../index";

const base = {
  project_id: "other-app",
  note: "Beim Speichern springt der Preis auf null.",
  annotation_data: { version: 1, marks: [] },
  device_context: {
    page_url: "https://example.com/cart?token=private#anchor",
    route: "/cart", viewport: { width: 390, height: 844 },
    device_type: "mobile", touch_enabled: true,
  },
};

function feedbackRequest(body: unknown) {
  return new Request("https://example.com/api/pointout/feedback", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("PointOut server handlers", () => {
  it("saves feedback for the configured project and strips URL secrets", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const handlers = createPointOutHandlers({ projectId: "other-app", store: { save }, rateLimit: () => true, transcribe: async () => "" });
    const response = await handlers.feedback(feedbackRequest(base));
    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({
      project_id: "other-app", feedback_text: base.note,
      page_url: "https://example.com/cart", device_type: "mobile", touch_enabled: true,
    });
    expect(save.mock.calls[0][1]).toBeNull();
  });

  it("keeps category, recent steps, app state and format details for the reader", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const handlers = createPointOutHandlers({ projectId: "other-app", store: { save }, rateLimit: () => true, transcribe: async () => "" });
    const response = await handlers.feedback(feedbackRequest({
      ...base,
      category: "bug",
      steps: [
        { seconds_before: 52, kind: "click", label: "Hoeren", area: "Gitarre", route: "/" },
        { seconds_before: 51, kind: "request", label: "POST 127.0.0.1:41872/input-monitor/start → 500", route: "/", count: 3 },
      ],
      app_context: { ansicht: "Instrumente", monitorLaeuft: false, kanaele: 18, interface: null },
      device_context: { ...base.device_context, orientation: "portrait", aspect_ratio: 0.46, color_scheme: "dark", language: "de-DE", scroll: { y: 1200, height: 3000 } },
    }));
    expect(response.status).toBe(201);
    expect(save.mock.calls[0][0].metadata).toEqual({
      category: "bug",
      steps: [
        { seconds_before: 52, kind: "click", label: "Hoeren", area: "Gitarre", route: "/" },
        { seconds_before: 51, kind: "request", label: "POST 127.0.0.1:41872/input-monitor/start → 500", route: "/", count: 3 },
      ],
      app_context: { ansicht: "Instrumente", monitorLaeuft: false, kanaele: 18, interface: null },
      format: { orientation: "portrait", aspect_ratio: 0.46, color_scheme: "dark", language: "de-DE", scroll: { y: 1200, height: 3000 } },
    });
  });

  it("drops malformed context pieces instead of rejecting the whole feedback", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const handlers = createPointOutHandlers({ projectId: "other-app", store: { save }, rateLimit: () => true, transcribe: async () => "" });
    const response = await handlers.feedback(feedbackRequest({
      ...base,
      category: "rant",
      steps: [
        { seconds_before: 5, kind: "keystroke", label: "geheim", route: "/" },
        { seconds_before: -1, kind: "click", label: "Zeitreise", route: "/" },
        { seconds_before: 3, kind: "click", label: "x".repeat(500), route: "/" },
        { seconds_before: 2, kind: "click", label: "Speichern", route: "/cart" },
      ],
      app_context: { ok: "ja", nested: { deep: true }, list: [1], big: "y".repeat(1000), ["k".repeat(200)]: 1 },
      device_context: { ...base.device_context, orientation: "sideways", aspect_ratio: "wide" },
    }));
    expect(response.status).toBe(201);
    expect(save.mock.calls[0][0].metadata).toEqual({
      category: "general",
      steps: [{ seconds_before: 2, kind: "click", label: "Speichern", route: "/cart" }],
      app_context: { ok: "ja" },
    });
  });

  it("rejects an unknown project, malformed marks, and an invalid screenshot before storage", async () => {
    const save = vi.fn();
    const handlers = createPointOutHandlers({ projectId: "other-app", store: { save }, rateLimit: () => true, transcribe: async () => "" });
    expect((await handlers.feedback(feedbackRequest({ ...base, project_id: "spoofed" }))).status).toBe(400);
    expect((await handlers.feedback(feedbackRequest({ ...base, annotation_data: { version: 1, marks: [{ tool: "arrow", points: [{ x: 2, y: 0 }] }] } }))).status).toBe(400);
    expect((await handlers.feedback(feedbackRequest({ ...base, screenshot_base64: "data:image/png;base64,YWJj" }))).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("limits requests and reports storage outages without accepting feedback", async () => {
    const save = vi.fn().mockRejectedValue(new Error("database secret"));
    const blocked = createPointOutHandlers({ projectId: "other-app", store: { save }, rateLimit: () => false, transcribe: async () => "" });
    expect((await blocked.feedback(feedbackRequest(base))).status).toBe(429);
    const failing = createPointOutHandlers({ projectId: "other-app", store: { save }, rateLimit: () => true, transcribe: async () => "" });
    const response = await failing.feedback(feedbackRequest(base));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database secret");
  });

  it("transcribes a supported recording and rejects an oversized body", async () => {
    const transcribe = vi.fn().mockResolvedValue("Der Knopf reagiert nicht.");
    const handlers = createPointOutHandlers({ projectId: "other-app", store: { save: vi.fn() }, rateLimit: () => true, transcribe });
    const form = new FormData();
    form.append("audio", new File(["recording"], "feedback.webm", { type: "audio/webm" }));
    const response = await handlers.transcribe(new Request("https://example.com/api/pointout/transcribe", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect((await response.json()).text).toBe("Der Knopf reagiert nicht.");
    expect(transcribe).toHaveBeenCalledOnce();
    const huge = new Request("https://example.com/api/pointout/transcribe", { method: "POST", body: form, headers: { "content-length": "99999999" } });
    expect((await handlers.transcribe(huge)).status).toBe(413);
  });

  it("requires a server key for the default OpenAI adapter", () => {
    expect(() => createOpenAITranscriber("")).toThrow("OPENAI_API_KEY");
  });
});

describe("Supabase storage adapter", () => {
  it("removes an uploaded image if the row insert fails", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: new Error("insert failed") });
    const client = { storage: { from: () => ({ upload, remove }) }, from: () => ({ insert }) };
    const store = createSupabaseStore(client as never);
    await expect(store.save({ id: "id", project_id: "app" } as never, { bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png", extension: "png" })).rejects.toThrow("insert failed");
    expect(upload).toHaveBeenCalledWith("app/id.png", expect.any(Uint8Array), expect.objectContaining({ upsert: false }));
    expect(remove).toHaveBeenCalledWith(["app/id.png"]);
  });
});
