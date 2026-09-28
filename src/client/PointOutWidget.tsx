"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ClipboardPaste, ImagePlus, Loader2, MessageSquarePlus, Mic, RotateCcw, Square, X } from "lucide-react";
import { useViewportHeight } from "./useViewportHeight";
import { cn } from "./cn";
import { useDictation } from "./useDictation";
import { captureAppScreen, flattenAnnotations, readManualScreenshot } from "../core/capture";
import { collectDeviceContext } from "../core/deviceContext";
import type { AnnotationMark } from "../core/annotation";
import { startStepRecorder, toSentSteps, type SentStep, type StepRecorder } from "../core/steps";
import { PointOutMarkup } from "./PointOutMarkup";

/** What the app itself knows about its state (current view, connection, mode). Keep values short. */
export type PointOutAppContext = Record<string, string | number | boolean | null>;

type Category = "bug" | "idea" | "design";
const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: "bug", label: "Fehler" },
  { value: "idea", label: "Idee" },
  { value: "design", label: "Design" },
];

function stepLine(step: SentStep): string {
  const time = `−${Math.floor(step.seconds_before / 60)}:${String(step.seconds_before % 60).padStart(2, "0")}`;
  const what = step.kind === "click" ? `Klick „${step.label}“${step.area ? ` · ${step.area}` : ""}`
    : step.kind === "error" ? `Fehler: ${step.label}` : `Anfrage: ${step.label}`;
  return `${time}  ${what}${step.count ? ` (${step.count}×)` : ""}`;
}

async function readAppContext(context: PointOutWidgetProps["context"]): Promise<PointOutAppContext | undefined> {
  if (!context) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(context),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 1_000); }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type PointOutWidgetProps = {
  projectId: string;
  projectName: string;
  appVersion?: string | null;
  feedbackUrl?: string;
  transcribeUrl?: string;
  sessionId?: string;
  targetType?: "page" | "chat_message" | "chat_session" | "design" | "generation";
  targetRef?: string;
  triggerVariant?: "floating" | "header" | "footer" | "icon";
  /** Read when the dialog opens (max. 1 s); errors are ignored. */
  context?: () => PointOutAppContext | Promise<PointOutAppContext>;
};

const subscribeToNothing = () => () => {};

export function PointOutWidget({
  projectId,
  projectName,
  appVersion = null,
  feedbackUrl = "/api/pointout/feedback",
  transcribeUrl = "/api/pointout/transcribe",
  sessionId,
  targetType = "page",
  targetRef,
  triggerVariant = "floating",
  context,
}: PointOutWidgetProps) {
  useViewportHeight();
  // Erst nach dem Hydrieren am body einhängen; der Server kennt kein document.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const captureRun = useRef(0);
  const [capturing, setCapturing] = useState(false);
  const [open, setOpen] = useState(false);
  const pagePath = typeof window === "undefined" ? "/" : window.location.pathname;
  const [previousPagePath, setPreviousPagePath] = useState(pagePath);
  if (previousPagePath !== pagePath) {
    setPreviousPagePath(pagePath);
    setCapturing(false);
    setOpen(false);
  }

  const [note, setNote] = useState("");
  const [transcriptOriginal, setTranscriptOriginal] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [captureSource, setCaptureSource] = useState<"automatic" | "manual" | null>(null);
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [captureError, setCaptureError] = useState("");
  const [resumedDraft, setResumedDraft] = useState(false);
  const [pasteMenu, setPasteMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [steps, setSteps] = useState<SentStep[]>([]);
  const [sendSteps, setSendSteps] = useState(true);
  const [showSteps, setShowSteps] = useState(false);
  const [appContext, setAppContext] = useState<PointOutAppContext | undefined>(undefined);
  const recorderRef = useRef<StepRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation((text) => {
    setTranscriptOriginal((current) => current ? current + "\n" + text : text);
    setNote((current) => current.trim() ? current.trimEnd() + " " + text : text);
  }, transcribeUrl);
  const { phase: dictationPhase, stop: stopDictation } = dictation;

  useEffect(() => {
    captureRun.current += 1;
  }, [pagePath]);
  useEffect(() => {
    const recorder = startStepRecorder({ ignoreUrls: [feedbackUrl, transcribeUrl] });
    recorderRef.current = recorder;
    return () => { recorder.stop(); recorderRef.current = null; };
  }, [feedbackUrl, transcribeUrl]);
  useEffect(() => {
    if (!open && dictationPhase === "recording") stopDictation();
  }, [open, dictationPhase, stopDictation]);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => { setOpen(false); setSaved(false); }, 1_800);
    return () => window.clearTimeout(timer);
  }, [saved]);
  // Lock the page only once the picture is taken: removing the scrollbar would
  // shift the layout in the middle of the capture.
  useEffect(() => {
    if (!open || capturing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKeyDown); };
  }, [open, capturing]);

  async function takeScreenshot() {
    const run = ++captureRun.current;
    setCapturing(true);
    setCaptureError("");
    setResumedDraft(false);
    setScreenshot(null);
    setCaptureSource(null);
    setMarks([]);
    // The sheet is there at once and the picture follows; on a tablet the wait
    // for "nothing" took seconds. The capture leaves the sheet out and starts
    // only once it is drawn, otherwise it would block the opening.
    setOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (run !== captureRun.current) return;
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        captureAppScreen(),
        new Promise<never>((_, reject) => {
          // The browser-drawn capture is faithful but takes 1-4 s on busy pages
          // (Firefox is slowest); giving up early would lose the right picture.
          captureTimer = setTimeout(() => reject(new Error("Screenshot dauert zu lange. Bitte wähle ein Bild aus.")), 12_000);
        }),
      ]);
      if (run === captureRun.current) {
        setScreenshot(result.dataUrl);
        setCaptureSource("automatic");
        setMarks([]);
      }
    } catch (cause) {
      if (run === captureRun.current) setCaptureError(cause instanceof Error ? cause.message : "Screenshot fehlgeschlagen. Bitte wähle ein Bild aus.");
    } finally {
      if (captureTimer) clearTimeout(captureTimer);
      if (run === captureRun.current) setCapturing(false);
    }
  }
  function openDialog() {
    setPasteMenu(false);
    // Keep an explicitly chosen image or a failed submission intact. Otherwise
    // recapture the current screen while retaining any text draft.
    if (captureSource === "manual" || error) {
      setResumedDraft(true);
      setOpen(true);
      return;
    }
    setError("");
    // Freeze what led here now; clicks inside the dialog are never recorded.
    const openedAt = Date.now();
    setSteps(toSentSteps(recorderRef.current?.snapshot() ?? [], openedAt));
    setSendSteps(true);
    setShowSteps(false);
    void readAppContext(context).then(setAppContext);
    void takeScreenshot();
  }
  const selectImage = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readManualScreenshot(file);
      setScreenshot(dataUrl);
      setCaptureSource("manual");
      setMarks([]);
      setCaptureError("");
      setPasteMenu(false);
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "Das Bild konnte nicht gelesen werden.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void selectImage(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, selectImage]);
  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error("Zwischenablage-Zugriff wird hier nicht unterstützt. Nutze bitte „Bild auswählen“.");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const mime = item.types.find((type) => type.startsWith("image/"));
        if (!mime) continue;
        const blob = await item.getType(mime);
        const extension = mime.split("/")[1] || "png";
        await selectImage(new File([blob], `clipboard.${extension}`, { type: mime }));
        return;
      }
      throw new Error("In der Zwischenablage ist kein Bild. Nutze bitte „Bild auswählen“.");
    } catch (cause) {
      setCaptureError(cause instanceof Error && cause.message.startsWith("In der Zwischenablage")
        ? cause.message : "Zwischenablage konnte nicht gelesen werden. Nutze Strg+V oder „Bild auswählen“.");
    }
  }
  async function saveNote() {
    if (!note.trim() || saving || capturing || dictation.phase !== "idle") return;
    setSaving(true);
    setError("");
    try {
      const context = await collectDeviceContext();
      const image = screenshot ? await flattenAnnotations(screenshot, marks) : null;
      if (image && image.length > 8_000_000) throw new Error("Das Bild ist zu groß. Bitte wähle einen kleineren Screenshot aus.");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      let response: Response;
      try {
        response = await fetch(feedbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          project_id: projectId,
          note: note.trim(),
          transcript_original: transcriptOriginal || null,
          category: category ?? "general",
          ...(sendSteps && steps.length ? { steps } : {}),
          ...(appContext ? { app_context: appContext } : {}),
          page_path: context.route,
          screenshot_base64: image,
          annotation_data: { version: 1, marks },
          device_context: context,
          app_version: appVersion,
          metadata: { capture_source: captureSource },
          session_id: sessionId,
          target_type: targetType,
          target_ref: targetRef,
        }),
      });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(response.status === 429
        ? "Bitte warte kurz und versuche es dann erneut."
        : "Feedback konnte nicht gesendet werden. Dein Entwurf bleibt erhalten.");
      setNote(""); setTranscriptOriginal(""); setScreenshot(null); setMarks([]); setCaptureSource(null);
      setCategory(null); setSteps([]); setAppContext(undefined);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error && (cause.message.startsWith("Das Bild") || cause.message.startsWith("Bitte warte"))
        ? cause.message : "Feedback konnte nicht gesendet werden. Dein Entwurf bleibt erhalten.");
    } finally {
      setSaving(false);
    }
  }

  // Touch first: every target is at least 44 px, labels stay visible, the text
  // field uses 16 px so phones do not zoom in, and presses give a visible dip.
  const press = "po:transition po:duration-150 po:active:scale-[0.96] po:focus-visible:outline-2 po:focus-visible:outline-offset-2 po:focus-visible:outline-violet-300";
  const chip = cn(press, "po:inline-flex po:min-h-12 po:items-center po:justify-center po:gap-2 po:whitespace-nowrap po:rounded-2xl po:bg-white/[0.06] po:px-3 po:text-sm po:text-zinc-200 po:ring-1 po:ring-white/10 po:hover:bg-white/10 po:disabled:opacity-40");

  const panel = open ? (
    <div data-pointout-root data-feedback-screenshot-ignore data-testid="feedback-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
      className="po:fixed po:inset-0 po:z-[100] po:flex po:items-end po:justify-center po:bg-zinc-950/70 po:p-0 po:backdrop-blur-sm po:sm:items-center po:sm:p-6">
      <div ref={dialogRef} data-feedback-panel role="dialog" aria-modal="true" aria-label="Feedback geben" tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.shiftKey && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void saveNote();
          }
        }}
        className="po:relative po:flex po:h-[var(--pointout-height,100dvh)] po:w-full po:flex-col po:overflow-hidden po:rounded-t-[28px] po:bg-zinc-950 po:bg-[radial-gradient(120%_70%_at_0%_0%,rgba(139,92,246,0.22),transparent_55%),radial-gradient(90%_60%_at_100%_100%,rgba(236,72,153,0.12),transparent_60%)] po:shadow-[0_-12px_60px_rgba(0,0,0,0.6)] po:outline-none po:ring-1 po:ring-white/10 po:sm:h-auto po:sm:max-h-[92dvh] po:sm:max-w-2xl po:sm:rounded-[28px] po:sm:shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
        <span aria-hidden="true" className="po:mx-auto po:mt-2 po:block po:h-1.5 po:w-10 po:shrink-0 po:rounded-full po:bg-white/20 po:sm:hidden" />
        {saved ? (
          <div data-testid="feedback-saved-state" className="po:flex po:flex-1 po:flex-col po:items-center po:justify-center po:gap-3 po:px-6 po:py-10 po:text-center">
            <span className="po:grid po:h-16 po:w-16 po:place-items-center po:rounded-full po:bg-emerald-400/15 po:ring-1 po:ring-emerald-300/30"><CheckCircle2 className="po:h-9 po:w-9 po:text-emerald-300" /></span>
            <p className="po:text-lg po:font-semibold po:text-white">Danke für dein Feedback!</p>
            <p className="po:text-sm po:text-zinc-400">Dein Hinweis ist angekommen.</p>
          </div>
        ) : (
          <>
            <header className="po:flex po:shrink-0 po:items-center po:justify-between po:gap-3 po:px-4 po:pt-2 po:pb-3 po:sm:px-6 po:sm:pt-5">
              <div className="po:min-w-0">
                <h3 className="po:flex po:items-center po:gap-2 po:text-lg po:font-semibold po:tracking-tight po:text-white">
                  <span aria-hidden="true" className="po:h-2.5 po:w-2.5 po:rounded-full po:bg-gradient-to-br po:from-violet-400 po:to-fuchsia-500 po:shadow-[0_0_12px_rgba(192,132,252,0.8)]" />Feedback
                </h3>
                <p className="po:truncate po:text-xs po:text-zinc-400">{resumedDraft ? "Ungesendeter Entwurf · Bild von vorher" : `${projectName} · Stelle markieren, dann beschreiben`}</p>
              </div>
              <button type="button" aria-label="Schließen" onClick={() => setOpen(false)} className={cn(press, "po:grid po:h-12 po:w-12 po:shrink-0 po:place-items-center po:rounded-full po:bg-white/[0.06] po:text-zinc-200 po:ring-1 po:ring-white/10 po:hover:bg-white/10")}><X className="po:h-5 po:w-5" /></button>
            </header>
            <div className="po:min-h-0 po:flex-1 po:overflow-y-auto po:overscroll-contain po:px-3 po:pb-3 po:sm:px-6 po:sm:pb-4">
              <div className="po:relative" onContextMenu={(event) => { event.preventDefault(); setPasteMenu(true); }}>
                {screenshot ? <PointOutMarkup screenshot={screenshot} marks={marks} onChange={setMarks} />
                  : capturing ? (
                    <div role="status" className="po:grid po:min-h-56 po:animate-pulse po:place-items-center po:rounded-2xl po:bg-white/[0.04] po:p-5 po:text-center po:text-sm po:text-zinc-300 po:ring-1 po:ring-white/10">
                      <span className="po:inline-flex po:items-center po:gap-2"><Loader2 className="po:h-4 po:w-4 po:animate-spin" />Screenshot wird aufgenommen … du kannst schon schreiben oder einsprechen.</span>
                    </div>
                  ) : <div className="po:grid po:min-h-48 po:place-items-center po:rounded-2xl po:border po:border-dashed po:border-white/15 po:bg-white/[0.03] po:p-5 po:text-center po:text-sm po:text-zinc-400">Kein Screenshot vorhanden – wähle ein Bild aus oder beschreibe den Fehler direkt.</div>}
                {pasteMenu ? <button type="button" onClick={() => { setPasteMenu(false); void pasteFromClipboard(); }}
                  className={cn(press, "po:absolute po:right-2 po:top-2 po:z-10 po:min-h-12 po:rounded-2xl po:bg-zinc-800 po:px-4 po:text-sm po:text-white po:shadow-lg po:ring-1 po:ring-white/15")}>
                  Bild aus Zwischenablage einfügen
                </button> : null}
              </div>
              {captureError ? <p role="alert" className="po:mt-2 po:rounded-xl po:bg-amber-400/10 po:px-3 po:py-2 po:text-sm po:text-amber-200">{captureError}</p> : null}
              <div className="po:mt-3 po:flex po:items-stretch po:gap-2">
                <input ref={fileRef} type="file" accept="image/*" aria-label="Screenshot auswählen" className="po:sr-only" onChange={(event) => void selectImage(event.target.files?.[0])} />
                <button type="button" onClick={() => fileRef.current?.click()} className={cn(chip, "po:flex-1")}><ImagePlus className="po:h-4 po:w-4" />Bild wählen</button>
                <button type="button" aria-label="Screenshot aus Zwischenablage einfügen" onClick={() => void pasteFromClipboard()} className={cn(chip, "po:flex-1")}><ClipboardPaste className="po:h-4 po:w-4" />Einfügen</button>
                <button type="button" aria-label="Aktuellen Bildschirm aufnehmen" disabled={capturing} onClick={() => void takeScreenshot()} className={cn(chip, "po:flex-1")}><RotateCcw className="po:h-4 po:w-4" /><span className="po:sm:hidden">Neu</span><span className="po:hidden po:sm:inline">Neu aufnehmen</span></button>
                {screenshot ? <button type="button" aria-label="Bild entfernen" title="Bild entfernen" onClick={() => { setScreenshot(null); setMarks([]); setCaptureSource(null); }} className={cn(chip, "po:w-12 po:shrink-0 po:px-0 po:text-zinc-400")}><X className="po:h-4 po:w-4" /></button> : null}
              </div>
              {steps.length ? (
                <div className="po:mt-3 po:rounded-2xl po:bg-white/[0.04] po:px-3 po:text-sm po:text-zinc-300 po:ring-1 po:ring-white/10">
                  <div className="po:flex po:items-center po:justify-between po:gap-2">
                    <label className="po:flex po:min-h-12 po:cursor-pointer po:items-center po:gap-3">
                      <input type="checkbox" checked={sendSteps} onChange={(event) => setSendSteps(event.target.checked)} className="po:h-5 po:w-5 po:accent-violet-500" />
                      Letzte Schritte mitsenden ({steps.length})
                    </label>
                    <button type="button" aria-expanded={showSteps} onClick={() => setShowSteps((current) => !current)} className={cn(press, "po:min-h-11 po:shrink-0 po:rounded-xl po:px-3 po:text-xs po:text-zinc-400 po:hover:bg-white/10")}>
                      {showSteps ? "Schritte ausblenden" : "Schritte ansehen"}
                    </button>
                  </div>
                  {showSteps ? (
                    <div className="po:pb-2">
                      <ol className="po:m-0 po:list-none po:space-y-0.5 po:p-0">
                        {steps.map((step, index) => (
                          <li key={`${step.seconds_before}-${step.kind}-${step.label}-${index}`} className="po:flex po:items-center po:justify-between po:gap-2">
                            <span className={cn("po:min-w-0 po:truncate po:font-mono po:text-[11px]", !sendSteps && "po:text-zinc-600 po:line-through")}>{stepLine(step)}</span>
                            <button type="button" aria-label={`Schritt entfernen: ${step.label}`} onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}
                              className={cn(press, "po:grid po:h-11 po:w-11 po:shrink-0 po:place-items-center po:rounded-xl po:text-zinc-500 po:hover:bg-white/10 po:hover:text-zinc-200")}><X className="po:h-4 po:w-4" /></button>
                          </li>
                        ))}
                      </ol>
                      <p className="po:mt-1 po:text-[11px] po:text-zinc-500">Nur Klicks, Fehler und fehlgeschlagene Anfragen – nie deine Eingaben.</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div data-testid="pointout-composer" className="po:shrink-0 po:border-t po:border-white/10 po:bg-zinc-950/80 po:px-3 po:pt-3 po:pb-[max(0.75rem,env(safe-area-inset-bottom))] po:backdrop-blur po:sm:px-6 po:sm:pb-5">
              <div role="group" aria-label="Art des Feedbacks (optional)" className="po:mb-3 po:flex po:gap-2">
                {CATEGORIES.map(({ value, label }) => (
                  <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory((current) => current === value ? null : value)}
                    className={cn(press, "po:min-h-11 po:flex-1 po:rounded-full po:px-4 po:text-sm po:font-medium po:ring-1 po:sm:flex-none", category === value ? "po:bg-violet-500 po:text-white po:ring-violet-300/60 po:shadow-[0_0_18px_rgba(139,92,246,0.45)]" : "po:bg-white/[0.05] po:text-zinc-300 po:ring-white/10 po:hover:bg-white/10")}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="po:flex po:items-end po:gap-2">
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Was ist passiert?" rows={2} maxLength={4000}
                  aria-label="Feedback-Text" className="po:min-h-16 po:flex-1 po:resize-none po:rounded-2xl po:bg-white/[0.05] po:text-base po:text-zinc-100 po:outline-none po:placeholder:text-zinc-500 po:focus:border-violet-400/70" />
                <button type="button" onClick={() => dictation.phase === "recording" ? dictation.stop() : void dictation.start()}
                  disabled={dictation.phase === "transcribing"} aria-label={dictation.phase === "recording" ? "Aufnahme beenden" : dictation.phase === "transcribing" ? "Aufnahme wird umgewandelt" : "Einsprechen"}
                  className={cn(press, "po:relative po:grid po:h-16 po:w-16 po:shrink-0 po:place-items-center po:rounded-2xl po:text-white po:shadow-lg po:disabled:opacity-60",
                    dictation.phase === "recording" ? "po:bg-rose-500 po:shadow-rose-900/50" : "po:bg-gradient-to-br po:from-violet-500 po:to-fuchsia-600 po:shadow-violet-900/50")}>
                  {dictation.phase === "recording" ? <span aria-hidden="true" className="po:absolute po:inset-0 po:animate-ping po:rounded-2xl po:bg-rose-400/40" /> : null}
                  {dictation.phase === "recording" ? <Square className="po:relative po:h-6 po:w-6 po:fill-current" /> : dictation.phase === "transcribing" ? <Loader2 className="po:h-6 po:w-6 po:animate-spin" /> : <Mic className="po:h-7 po:w-7" />}
                </button>
              </div>
              {dictation.phase !== "idle" ? <p role="status" className="po:mt-2 po:text-xs po:text-zinc-300">{dictation.phase === "recording" ? "Aufnahme läuft · Mikrofon zum Beenden tippen" : "Sprache wird in Text umgewandelt …"}</p> : null}
              {dictation.error ? <p role="alert" className="po:mt-2 po:text-sm po:text-amber-200">{dictation.error}</p> : null}
              {error ? <p role="alert" className="po:mt-2 po:text-sm po:text-rose-300">{error}</p> : null}
              <button type="button" onClick={() => void saveNote()} disabled={!note.trim() || saving || capturing || dictation.phase !== "idle"}
                className={cn(press, "po:mt-3 po:flex po:min-h-14 po:w-full po:items-center po:justify-center po:rounded-2xl po:bg-gradient-to-r po:from-violet-500 po:to-fuchsia-600 po:text-base po:font-semibold po:text-white po:shadow-[0_10px_30px_rgba(139,92,246,0.35)] po:hover:brightness-110 po:disabled:opacity-40 po:disabled:shadow-none")}>
                {saving ? <><Loader2 className="po:mr-2 po:h-4 po:w-4 po:animate-spin" />Senden …</> : <>Feedback senden <kbd aria-hidden="true" className="po:ml-3 po:hidden po:font-mono po:text-[10px] po:font-normal po:text-violet-100/80 po:sm:inline">Strg + ⇧ + Enter</kbd></>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  const trigger = (
    <button data-pointout-root aria-label={triggerVariant === "footer" ? "Feedback senden" : "Feedback geben"} title={triggerVariant === "icon" ? "Feedback geben" : undefined}
      data-feedback-screenshot-ignore onClick={openDialog} disabled={capturing}
      data-feedback-trigger={triggerVariant === "floating" || triggerVariant === "footer" ? "fixed" : undefined}
      className={cn(
        press, "po:inline-flex po:items-center",
        triggerVariant === "floating" ? "po:fixed po:right-4 po:bottom-[max(1rem,env(safe-area-inset-bottom))] po:z-[80] po:min-h-12 po:gap-2 po:rounded-full po:bg-zinc-900/85 po:px-5 po:text-sm po:font-medium po:text-zinc-50 po:shadow-[0_10px_30px_rgba(0,0,0,0.45)] po:ring-1 po:ring-white/15 po:backdrop-blur-md po:hover:bg-zinc-800 po:sm:right-5 po:sm:bottom-5"
          : triggerVariant === "icon" ? "po:relative po:z-10 po:h-11 po:w-11 po:justify-center po:rounded-xl po:text-zinc-400 po:ring-1 po:ring-white/10 po:hover:bg-white/10 po:hover:text-zinc-100"
          : triggerVariant === "footer" ? "po:fixed po:right-0 po:bottom-5 po:z-[80] po:min-h-11 po:gap-1.5 po:rounded-l-2xl po:bg-zinc-900/90 po:px-4 po:text-sm po:text-zinc-100 po:shadow-md po:ring-1 po:ring-violet-400/40 po:backdrop-blur po:sm:static po:sm:z-auto po:sm:min-h-0 po:sm:rounded-none po:sm:bg-transparent po:sm:px-0 po:sm:text-xs po:sm:text-zinc-500 po:sm:shadow-none po:sm:ring-0 po:sm:backdrop-blur-none po:sm:hover:text-zinc-200"
          : "po:relative po:z-10 po:min-h-11 po:gap-2 po:rounded-full po:bg-zinc-900/85 po:px-4 po:text-sm po:text-zinc-100 po:shadow-lg po:ring-1 po:ring-white/15 po:backdrop-blur po:hover:bg-zinc-800"
      )}>
      {capturing ? <Loader2 className="po:h-4 po:w-4 po:animate-spin" />
        : triggerVariant === "floating" ? <span aria-hidden="true" className="po:relative po:grid po:h-6 po:w-6 po:place-items-center po:rounded-full po:bg-gradient-to-br po:from-violet-500 po:to-fuchsia-600"><MessageSquarePlus className="po:h-3.5 po:w-3.5 po:text-white" /></span>
        : <MessageSquarePlus className={cn("po:h-4 po:w-4", triggerVariant === "footer" && "po:sm:h-3.5 po:sm:w-3.5")} />}
      {triggerVariant === "footer" ? <span>Feedback</span> : triggerVariant !== "icon" ? "Feedback" : null}
    </button>
  );

  return <>
    {/* Der schwebende Knopf steckt sonst in der Bühne, deren Ebene unter der
        Handy-Leiste liegt; am body bleibt er über ihr erreichbar. Eine im
        Hintergrund gehaltene Ansicht zeigt ihn dort nicht mehr. */}
    {triggerVariant === "floating" ? (mounted ? createPortal(trigger, document.body) : null) : trigger}
    {typeof document === "undefined" ? panel : createPortal(panel, document.body)}
  </>;
}
