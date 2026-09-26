import { afterEach, describe, expect, it, vi } from "vitest";
import { startStepRecorder, toSentSteps, type StepRecorder } from "../steps";

let recorder: StepRecorder | null = null;
afterEach(() => {
  recorder?.stop();
  recorder = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("step recorder", () => {
  it("records clicks on controls with their label and the surrounding area", () => {
    document.body.innerHTML = `
      <section data-pointout-area="Gitarre"><button><svg></svg> Hoeren </button></section>
      <nav aria-label="Hauptnavigation"><a href="/rack">Instrumente</a></nav>
      <div role="tab" aria-label="Karten-Ansicht">K</div>`;
    recorder = startStepRecorder();
    click(document.querySelector("svg")!);
    click(document.querySelector("a")!);
    click(document.querySelector("[role=tab]")!);
    expect(recorder.snapshot().map(({ kind, label, area }) => ({ kind, label, area }))).toEqual([
      { kind: "click", label: "Hoeren", area: "Gitarre" },
      { kind: "click", label: "Instrumente", area: "Hauptnavigation" },
      { kind: "click", label: "Karten-Ansicht", area: undefined },
    ]);
  });

  it("ignores plain text, private areas and PointOut's own interface", () => {
    document.body.innerHTML = `
      <p>Nur Text</p>
      <div data-pointout-private><button>Konto 1234</button></div>
      <button data-pointout-root>Feedback geben</button>
      <input type="text" aria-label="Name" />`;
    recorder = startStepRecorder();
    click(document.querySelector("p")!);
    click(document.querySelector("[data-pointout-private] button")!);
    click(document.querySelector("[data-pointout-root]")!);
    const input = document.querySelector("input")!;
    click(input);
    input.value = "Geheimer Text";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "G", bubbles: true }));
    expect(recorder.snapshot()).toEqual([]);
  });

  it("records script errors and unhandled promise rejections", () => {
    recorder = startStepRecorder();
    window.dispatchEvent(new ErrorEvent("error", { message: "TypeError: gain is undefined", filename: "http://localhost:5173/src/app/App.tsx?t=1", lineno: 42 }));
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new Error("Monitor start failed");
    window.dispatchEvent(rejection);
    expect(recorder.snapshot().map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: "error", label: "TypeError: gain is undefined (App.tsx:42)" },
      { kind: "error", label: "Monitor start failed" },
    ]);
  });

  it("records failed requests without query or body and skips successful and ignored ones", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("offline")) throw new TypeError("Failed to fetch");
      return new Response("{}", { status: url.includes("start") ? 500 : 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    recorder = startStepRecorder({ ignoreUrls: ["http://127.0.0.1:41872/pointout/feedback"] });
    await window.fetch("http://127.0.0.1:41872/input-monitor/start?token=geheim", { method: "post", body: "{\"gain\":1}" });
    await window.fetch("/health");
    await window.fetch("http://127.0.0.1:41872/pointout/feedback", { method: "POST" }).catch(() => undefined);
    await window.fetch("https://api.example.test/offline").catch(() => undefined);
    expect(recorder.snapshot().map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: "request", label: "POST 127.0.0.1:41872/input-monitor/start → 500" },
      { kind: "request", label: "GET api.example.test/offline → Netzwerkfehler" },
    ]);
  });

  it("merges repeating request failures instead of flooding the list", async () => {
    let clock = 1_000;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    recorder = startStepRecorder({ now: () => clock });
    document.body.innerHTML = "<button>Hoeren</button>";
    for (let i = 0; i < 3; i += 1) {
      await window.fetch("/peak-watch/snapshot");
      clock += 1_000;
      click(document.querySelector("button")!);
    }
    const steps = recorder.snapshot();
    expect(steps.filter((step) => step.kind === "request")).toEqual([
      expect.objectContaining({ label: `GET ${location.host}/peak-watch/snapshot → 404`, count: 3, at: 3_000 }),
    ]);
    expect(steps.filter((step) => step.kind === "click")).toHaveLength(3);
  });

  it("keeps the last 20 steps of the last three minutes", () => {
    let clock = 0;
    document.body.innerHTML = Array.from({ length: 25 }, (_, i) => `<button>Knopf ${i}</button>`).join("");
    recorder = startStepRecorder({ now: () => clock });
    document.querySelectorAll("button").forEach((button) => { clock += 1_000; click(button); });
    expect(recorder.snapshot()).toHaveLength(20);
    expect(recorder.snapshot()[0].label).toBe("Knopf 5");
    // Knopf 23 was clicked one second before Knopf 24: exactly three minutes old now.
    clock += 3 * 60_000 - 1_000;
    expect(recorder.snapshot().map((step) => step.label)).toEqual(["Knopf 23", "Knopf 24"]);
  });

  it("stops listening and gives fetch back when stopped", async () => {
    const original = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", original);
    document.body.innerHTML = "<button>Hoeren</button>";
    recorder = startStepRecorder();
    recorder.stop();
    expect(window.fetch).toBe(original);
    click(document.querySelector("button")!);
    await window.fetch("/x");
    expect(recorder.snapshot()).toEqual([]);
  });
});

describe("toSentSteps", () => {
  it("expresses each step as seconds before the dialog opened", () => {
    expect(toSentSteps([
      { kind: "click", label: "Hoeren", area: "Gitarre", route: "/", at: 8_000, count: 1 },
      { kind: "request", label: "GET /x → 404", route: "/", at: 59_600, count: 4 },
    ], 60_000)).toEqual([
      { seconds_before: 52, kind: "click", label: "Hoeren", area: "Gitarre", route: "/" },
      { seconds_before: 0, kind: "request", label: "GET /x → 404", route: "/", count: 4 },
    ]);
  });
});
