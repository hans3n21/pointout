// Records what the user did shortly before opening the feedback dialog, so an
// AI reading the feedback sees the path to the problem. Memory only: nothing is
// stored, and steps leave the device only when the user sends feedback.
// Never recorded: typed text, field values, request/response bodies, query
// strings, anything inside [data-pointout-private] or PointOut's own UI.

export type PointOutStepKind = "click" | "error" | "request";

export type PointOutStep = {
  kind: PointOutStepKind;
  label: string;
  area?: string;
  route: string;
  at: number;
  count: number;
};

export type SentStep = {
  seconds_before: number;
  kind: PointOutStepKind;
  label: string;
  area?: string;
  route: string;
  count?: number;
};

export type StepRecorder = { snapshot: () => PointOutStep[]; stop: () => void };

type RecorderOptions = {
  target?: Window;
  now?: () => number;
  maxSteps?: number;
  maxAgeMs?: number;
  ignoreUrls?: string[];
};

const CONTROLS = [
  "button", "a[href]", "summary", "select",
  "input[type=checkbox]", "input[type=radio]", "input[type=submit]", "input[type=button]",
  ...["button", "tab", "link", "menuitem", "switch", "checkbox", "radio", "option"].map((role) => `[role=${role}]`),
].join(",");

function short(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function labelOf(element: Element): string {
  const labelled = element as HTMLInputElement;
  return short(
    element.getAttribute("aria-label")
      || labelled.labels?.[0]?.textContent
      || element.textContent
      || element.getAttribute("title")
      || element.tagName.toLowerCase(),
    60,
  );
}

function areaOf(element: Element): string | undefined {
  const area = element.parentElement?.closest("[data-pointout-area], [aria-label]");
  const text = area?.getAttribute("data-pointout-area") ?? area?.getAttribute("aria-label");
  return text ? short(text, 60) : undefined;
}

function requestTarget(raw: string, base: string): string {
  try {
    const url = new URL(raw, base);
    return url.host + url.pathname;
  } catch {
    return short(raw.split(/[?#]/, 1)[0], 120);
  }
}

export function startStepRecorder({
  target = window,
  now = () => Date.now(),
  maxSteps = 20,
  maxAgeMs = 3 * 60_000,
  ignoreUrls = [],
}: RecorderOptions = {}): StepRecorder {
  let steps: PointOutStep[] = [];
  let active = true;
  const ignored = new Set(ignoreUrls.map((url) => requestTarget(url, target.location.href)));

  function add(kind: PointOutStepKind, label: string, area?: string) {
    if (!active || !label) return;
    const at = now();
    const route = target.location.pathname;
    // Polling apps repeat the same failure every few seconds; errors and
    // requests merge wherever they are, clicks only when directly repeated.
    const index = kind === "click"
      ? (steps.length && steps[steps.length - 1].kind === "click" && steps[steps.length - 1].label === label && steps[steps.length - 1].area === area ? steps.length - 1 : -1)
      : steps.findIndex((step) => step.kind === kind && step.label === label);
    if (index >= 0) {
      const [existing] = steps.splice(index, 1);
      steps.push({ ...existing, at, route, count: existing.count + 1 });
    } else {
      steps.push({ kind, label, area, route, at, count: 1 });
    }
    if (steps.length > maxSteps) steps = steps.slice(-maxSteps);
  }

  const onClick = (event: MouseEvent) => {
    const origin = event.target instanceof Element ? event.target : null;
    const control = origin?.closest(CONTROLS);
    if (!control || control.closest("[data-pointout-private], [data-pointout-root]")) return;
    add("click", labelOf(control), areaOf(control));
  };
  const onError = (event: ErrorEvent) => {
    const file = event.filename ? event.filename.split(/[?#]/, 1)[0].split("/").pop() : "";
    add("error", short(event.message || "Unbekannter Fehler", 160) + (file ? ` (${file}:${event.lineno})` : ""));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    add("error", short(reason instanceof Error ? reason.message : String(reason), 160));
  };

  const originalFetch = target.fetch;
  const recordingFetch: typeof fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const where = requestTarget(raw, target.location.href);
    const record = !ignored.has(where);
    try {
      const response = await originalFetch.call(target, input, init);
      if (record && !response.ok) add("request", `${method} ${where} → ${response.status}`);
      return response;
    } catch (cause) {
      if (record && !(cause instanceof DOMException && cause.name === "AbortError")) add("request", `${method} ${where} → Netzwerkfehler`);
      throw cause;
    }
  };

  target.document.addEventListener("click", onClick, true);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  target.fetch = recordingFetch;

  return {
    snapshot: () => {
      const oldest = now() - maxAgeMs;
      return steps.filter((step) => step.at >= oldest).map((step) => ({ ...step }));
    },
    stop: () => {
      active = false;
      target.document.removeEventListener("click", onClick, true);
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
      // Only undo our own wrapper; another library may have wrapped fetch after us.
      if (target.fetch === recordingFetch) target.fetch = originalFetch;
    },
  };
}

export function toSentSteps(steps: PointOutStep[], openedAt: number): SentStep[] {
  return steps.map(({ kind, label, area, route, at, count }) => ({
    seconds_before: Math.max(0, Math.round((openedAt - at) / 1000)),
    kind,
    label,
    ...(area ? { area } : {}),
    route,
    ...(count > 1 ? { count } : {}),
  }));
}
