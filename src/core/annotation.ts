export type Point = { x: number; y: number };
export type AnnotationTool = "freehand" | "rectangle" | "circle" | "arrow";
export type AnnotationMark = { tool: AnnotationTool; points: Point[] };

type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function normalizePoint(clientX: number, clientY: number, rect: Rect): Point {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height)),
  };
}

export function arrowHead(from: Point, tip: Point): [Point, Point] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const length = 0.04;
  const spread = Math.PI / 6;
  return [
    { x: tip.x - Math.cos(angle + spread) * length, y: tip.y - Math.sin(angle + spread) * length },
    { x: tip.x - Math.cos(angle - spread) * length, y: tip.y - Math.sin(angle - spread) * length },
  ];
}

export function drawMarks(context: CanvasRenderingContext2D, marks: AnnotationMark[], width: number, height: number) {
  context.strokeStyle = "#f43f5e";
  context.lineWidth = Math.max(3, Math.min(width, height) * 0.006);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const mark of marks) {
    const first = mark.points[0];
    if (!first) continue;
    const last = mark.points.at(-1) ?? first;
    context.beginPath();
    if (mark.tool === "freehand") {
      context.moveTo(first.x * width, first.y * height);
      for (const point of mark.points.slice(1)) context.lineTo(point.x * width, point.y * height);
      if (mark.points.length === 1) context.lineTo(first.x * width + 0.1, first.y * height + 0.1);
    } else if (mark.tool === "rectangle") {
      context.rect(first.x * width, first.y * height, (last.x - first.x) * width, (last.y - first.y) * height);
    } else if (mark.tool === "circle") {
      const centerX = (first.x + last.x) * width / 2;
      const centerY = (first.y + last.y) * height / 2;
      const radiusX = Math.abs(last.x - first.x) * width / 2;
      const radiusY = Math.abs(last.y - first.y) * height / 2;
      context.ellipse(centerX, centerY, Math.max(radiusX, 0.1), Math.max(radiusY, 0.1), 0, 0, Math.PI * 2);
    } else {
      context.moveTo(first.x * width, first.y * height);
      context.lineTo(last.x * width, last.y * height);
      const [a, b] = arrowHead(first, last);
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(last.x * width, last.y * height);
      context.lineTo(b.x * width, b.y * height);
    }
    context.stroke();
  }
}
