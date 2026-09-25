import { describe, expect, it } from "vitest";
import { arrowHead, normalizePoint } from "../annotation";

describe("PointOut annotation geometry", () => {
  it("normalizes and clamps pointer positions across a resized image", () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(normalizePoint(110, 70, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizePoint(-5, 300, rect)).toEqual({ x: 0, y: 1 });
  });

  it("places both arrow wings behind the tip", () => {
    const [a, b] = arrowHead({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 });
    expect(a.x).toBeLessThan(0.9);
    expect(b.x).toBeLessThan(0.9);
    expect(a.y).toBeLessThan(0.5);
    expect(b.y).toBeGreaterThan(0.5);
  });
});
