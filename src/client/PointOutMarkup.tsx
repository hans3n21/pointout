"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, Eraser, Hand, Minus, Pencil, Plus, RectangleHorizontal, Undo2 } from "lucide-react";
import { arrowHead, normalizePoint, type AnnotationMark, type AnnotationTool, type Point } from "../core/annotation";
import { cn } from "./cn";

const TOOLS: { id: AnnotationTool; label: string; icon: typeof Pencil }[] = [
  { id: "freehand", label: "Freihand", icon: Pencil },
  { id: "rectangle", label: "Rechteck", icon: RectangleHorizontal },
  { id: "circle", label: "Kreis", icon: Circle },
  { id: "arrow", label: "Pfeil", icon: ArrowUpRight },
];

function Mark({ mark }: { mark: AnnotationMark }) {
  const first = mark.points[0];
  if (!first) return null;
  const last = mark.points.at(-1) ?? first;
  const x1 = first.x * 1000; const y1 = first.y * 1000;
  const x2 = last.x * 1000; const y2 = last.y * 1000;
  const shared = { fill: "none", stroke: "#f43f5e", strokeWidth: 4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, vectorEffect: "non-scaling-stroke" as const };
  if (mark.tool === "freehand") {
    return <polyline {...shared} points={mark.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} />;
  }
  if (mark.tool === "rectangle") {
    return <rect {...shared} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} />;
  }
  if (mark.tool === "circle") {
    return <ellipse {...shared} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} />;
  }
  const [a, b] = arrowHead(first, last);
  return <path {...shared} d={`M ${x1} ${y1} L ${x2} ${y2} M ${a.x * 1000} ${a.y * 1000} L ${x2} ${y2} L ${b.x * 1000} ${b.y * 1000}`} />;
}

export function PointOutMarkup({ screenshot, marks, onChange }: {
  screenshot: string;
  marks: AnnotationMark[];
  onChange: (marks: AnnotationMark[]) => void;
}) {
  const [tool, setTool] = useState<AnnotationTool | "pan">("freehand");
  const [draft, setDraft] = useState<AnnotationMark | null>(null);
  const [zoom, setZoom] = useState(1);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [previousScreenshot, setPreviousScreenshot] = useState(screenshot);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const activePointer = useRef<number | null>(null);
  const draftRef = useRef<AnnotationMark | null>(null);
  const panRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef(false);
  const pinchRef = useRef<{ distance: number; zoom: number; x: number; y: number } | null>(null);

  if (previousScreenshot !== screenshot) {
    setPreviousScreenshot(screenshot);
    setZoom(1);
    setBaseSize(null);
  }

  useLayoutEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const reset = () => {
      zoomRef.current = 1;
      setZoom(1);
      setBaseSize(null);
    };
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);

  useLayoutEffect(() => {
    if (baseSize) return;
    const image = imageRef.current;
    if (!image?.complete || !image.naturalWidth) return;
    const rect = image.getBoundingClientRect();
    if (rect.width && rect.height) setBaseSize({ width: rect.width, height: rect.height });
  }, [baseSize, screenshot]);

  function measureImage() {
    const rect = imageRef.current?.getBoundingClientRect();
    if (rect?.width && rect.height) setBaseSize({ width: rect.width, height: rect.height });
  }

  function limitZoom(value: number) {
    return Math.max(1, Math.min(4, Math.round(value * 100) / 100));
  }

  function horizontalOffset(level: number) {
    const viewport = viewportRef.current;
    return viewport && baseSize ? Math.max(0, (viewport.clientWidth - baseSize.width * level) / 2) : 0;
  }

  function setZoomAt(value: number, anchorX: number, anchorY: number) {
    const viewport = viewportRef.current;
    const next = limitZoom(value);
    const previous = zoomRef.current;
    if (!viewport || next === previous) return;
    const imageX = (viewport.scrollLeft + anchorX - horizontalOffset(previous)) / previous;
    const imageY = (viewport.scrollTop + anchorY) / previous;
    zoomRef.current = next;
    setZoom(next);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = imageX * next + horizontalOffset(next) - anchorX;
      viewport.scrollTop = imageY * next - anchorY;
    });
  }

  function zoomBy(step: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setZoomAt(zoomRef.current + step, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }

  function pinchPoints() {
    return Array.from(touchesRef.current.values()).slice(0, 2);
  }

  function pinchCenter(points: { x: number; y: number }[]) {
    const viewport = viewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    return {
      x: (points[0].x + points[1].x) / 2 - (rect?.left ?? 0),
      y: (points[0].y + points[1].y) / 2 - (rect?.top ?? 0),
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
    };
  }

  function point(event: React.PointerEvent<SVGSVGElement>): Point {
    return normalizePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }
  function start(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") {
      if (touchesRef.current.size >= 2) { event.preventDefault(); return; }
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size === 2) {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        gestureRef.current = true;
        activePointer.current = null;
        panRef.current = null;
        draftRef.current = null;
        setDraft(null);
        const center = pinchCenter(pinchPoints());
        const viewport = viewportRef.current;
        pinchRef.current = {
          distance: Math.max(1, center.distance), zoom: zoomRef.current,
          x: ((viewport?.scrollLeft ?? 0) + center.x - horizontalOffset(zoomRef.current)) / zoomRef.current,
          y: ((viewport?.scrollTop ?? 0) + center.y) / zoomRef.current,
        };
        return;
      }
    }
    if (gestureRef.current) return;
    if (activePointer.current !== null) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === "pan") {
      const viewport = viewportRef.current;
      panRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
        left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 };
      return;
    }
    const next = { tool, points: [point(event)] };
    draftRef.current = next;
    setDraft(next);
  }
  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch" && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gestureRef.current && pinchRef.current && touchesRef.current.size >= 2) {
        event.preventDefault();
        const center = pinchCenter(pinchPoints());
        const start = pinchRef.current;
        const next = limitZoom(start.zoom * center.distance / start.distance);
        zoomRef.current = next;
        setZoom(next);
        window.requestAnimationFrame(() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          viewport.scrollLeft = start.x * next + horizontalOffset(next) - center.x;
          viewport.scrollTop = start.y * next - center.y;
        });
        return;
      }
    }
    if (gestureRef.current) return;
    if (panRef.current && panRef.current.id === event.pointerId) {
      event.preventDefault();
      const viewport = viewportRef.current;
      if (viewport) {
        viewport.scrollLeft = panRef.current.left + panRef.current.x - event.clientX;
        viewport.scrollTop = panRef.current.top + panRef.current.y - event.clientY;
      }
      return;
    }
    if (activePointer.current !== event.pointerId || !draftRef.current) return;
    event.preventDefault();
    const current = draftRef.current;
    const next = { ...current, points: current.tool === "freehand" ? [...current.points, point(event)] : [current.points[0], point(event)] };
    draftRef.current = next;
    setDraft(next);
  }
  function finish(event: React.PointerEvent<SVGSVGElement>) {
    const wasGesture = gestureRef.current;
    if (event.pointerType === "touch") {
      touchesRef.current.delete(event.pointerId);
      if (touchesRef.current.size < 2) pinchRef.current = null;
      if (touchesRef.current.size === 0) gestureRef.current = false;
    }
    if (wasGesture) { event.preventDefault(); return; }
    if (panRef.current && panRef.current.id === event.pointerId) {
      panRef.current = null;
      activePointer.current = null;
      return;
    }
    if (activePointer.current !== event.pointerId || !draftRef.current) return;
    event.preventDefault();
    const current = draftRef.current;
    const final = { ...current, points: current.tool === "freehand" ? [...current.points, point(event)] : [current.points[0], point(event)] };
    onChange([...marks, final]);
    activePointer.current = null;
    draftRef.current = null;
    setDraft(null);
  }
  function cancel(event: React.PointerEvent<SVGSVGElement>) {
    const wasGesture = gestureRef.current;
    if (event.pointerType === "touch") {
      touchesRef.current.delete(event.pointerId);
      if (touchesRef.current.size < 2) pinchRef.current = null;
      if (touchesRef.current.size === 0) gestureRef.current = false;
    }
    if (wasGesture) return;
    if (panRef.current && panRef.current.id === event.pointerId) {
      panRef.current = null;
      activePointer.current = null;
      return;
    }
    if (activePointer.current !== event.pointerId) return;
    if (draftRef.current) onChange([...marks, draftRef.current]);
    activePointer.current = null;
    draftRef.current = null;
    setDraft(null);
  }

  return (
    <div>
      <div ref={viewportRef} className="po:max-h-[48dvh] po:overflow-auto po:rounded-xl po:border po:border-zinc-700 po:bg-zinc-950" aria-label="Screenshot-Ausschnitt">
        <div data-testid="pointout-zoom-surface" className="po:relative po:mx-auto"
          style={baseSize ? { width: `${baseSize.width * zoom}px`, height: `${baseSize.height * zoom}px` } : { width: "fit-content" }}>
          <div className="po:relative" style={baseSize ? { width: `${baseSize.width}px`, height: `${baseSize.height}px`, transform: `scale(${zoom})`, transformOrigin: "top left" } : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imageRef} src={screenshot} alt="Screenshot für dein Feedback" onLoad={measureImage} className="po:block po:max-h-[48dvh] po:max-w-full" />
            <svg
              role="img"
              aria-label="Screenshot markieren"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className={cn("po:absolute po:inset-0 po:h-full po:w-full po:touch-none", tool === "pan" ? "po:cursor-grab" : "po:cursor-crosshair")}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancel}
            >
              {marks.map((mark, index) => <Mark key={index} mark={mark} />)}
              {draft ? <Mark mark={draft} /> : null}
            </svg>
          </div>
        </div>
      </div>
      <div className="po:mt-2 po:flex po:items-center po:gap-2">
        <div className="po:flex po:min-w-0 po:flex-1 po:gap-1.5 po:overflow-x-auto po:pb-1" role="toolbar" aria-label="Markierungswerkzeuge">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)}
              className={cn("po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-lg po:border po:px-2 po:text-xs", tool === id ? "po:border-rose-400 po:bg-rose-500/15 po:text-rose-100" : "po:border-zinc-700 po:text-zinc-300")}
            ><Icon className="po:h-4 po:w-4" /><span className="po:ml-1 po:hidden po:sm:inline">{label}</span></button>
          ))}
          <button type="button" aria-label="Verschieben" aria-pressed={tool === "pan"} onClick={() => setTool("pan")}
            className={cn("po:flex po:min-h-11 po:min-w-11 po:shrink-0 po:items-center po:justify-center po:rounded-lg po:border", tool === "pan" ? "po:border-rose-400 po:bg-rose-500/15 po:text-rose-100" : "po:border-zinc-700 po:text-zinc-300")}><Hand className="po:h-4 po:w-4" /></button>
          <button type="button" aria-label="Rückgängig" disabled={marks.length === 0} onClick={() => onChange(marks.slice(0, -1))} className="po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-lg po:border po:border-zinc-700 po:text-zinc-300 po:disabled:opacity-40"><Undo2 className="po:h-4 po:w-4" /></button>
          <button type="button" aria-label="Markierungen löschen" disabled={marks.length === 0} onClick={() => onChange([])} className="po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-lg po:border po:border-zinc-700 po:text-zinc-300 po:disabled:opacity-40"><Eraser className="po:h-4 po:w-4" /></button>
        </div>
        <div role="group" aria-label="Zoom" className="po:flex po:shrink-0 po:items-center po:gap-1 po:border-l po:border-zinc-700 po:pl-2 po:pb-1">
          <button type="button" aria-label="Verkleinern" disabled={zoom <= 1} onClick={() => zoomBy(-0.5)} className="po:flex po:min-h-11 po:min-w-9 po:items-center po:justify-center po:rounded-lg po:border po:border-zinc-700 po:text-zinc-300 po:disabled:opacity-40"><Minus className="po:h-4 po:w-4" /></button>
          <span data-testid="pointout-zoom-level" className="po:min-w-10 po:text-center po:text-xs po:tabular-nums po:text-zinc-400">{Math.round(zoom * 100)} %</span>
          <button type="button" aria-label="Vergrößern" disabled={zoom >= 4} onClick={() => zoomBy(0.5)} className="po:flex po:min-h-11 po:min-w-9 po:items-center po:justify-center po:rounded-lg po:border po:border-zinc-700 po:text-zinc-300 po:disabled:opacity-40"><Plus className="po:h-4 po:w-4" /></button>
        </div>
      </div>
    </div>
  );
}
