import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PointOutMarkup } from "../PointOutMarkup";

afterEach(cleanup);

function pointer(element: Element, type: string, properties: { pointerId: number; pointerType: string; clientX: number; clientY: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  fireEvent(element, event);
}

describe("PointOutMarkup", () => {
  it("keeps normalized coordinates after zooming with the buttons", () => {
    const onChange = vi.fn();
    render(<PointOutMarkup screenshot="data:image/png;base64,dGVzdA==" marks={[]} onChange={onChange} />);
    const image = screen.getByAltText("Screenshot für dein Feedback");
    image.getBoundingClientRect = () => ({ width: 200, height: 100 } as DOMRect);
    fireEvent.load(image);
    fireEvent.click(screen.getByRole("button", { name: "Vergrößern" }));
    expect(screen.getByTestId("pointout-zoom-surface").getAttribute("style")).toContain("width: 300px");
    const surface = screen.getByRole("img", { name: "Screenshot markieren" });
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 } as DOMRect);
    pointer(surface, "pointerdown", { pointerId: 1, pointerType: "mouse", clientX: 75, clientY: 75 });
    pointer(surface, "pointerup", { pointerId: 1, pointerType: "mouse", clientX: 150, clientY: 75 });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ points: [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }] })]);
  });

  it("uses two fingers to zoom without leaving an accidental mark", () => {
    const onChange = vi.fn();
    render(<PointOutMarkup screenshot="data:image/png;base64,dGVzdA==" marks={[]} onChange={onChange} />);
    const image = screen.getByAltText("Screenshot für dein Feedback");
    image.getBoundingClientRect = () => ({ width: 200, height: 100 } as DOMRect);
    fireEvent.load(image);
    const surface = screen.getByRole("img", { name: "Screenshot markieren" });
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
    pointer(surface, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 });
    pointer(surface, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 100, clientY: 50 });
    pointer(surface, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 150, clientY: 50 });
    pointer(surface, "pointerup", { pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 });
    pointer(surface, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 150, clientY: 50 });
    expect(screen.getByTestId("pointout-zoom-level").textContent).toContain("200 %");
    expect(onChange).not.toHaveBeenCalled();
  });

  function mounted() {
    const onChange = vi.fn();
    render(<PointOutMarkup screenshot="data:image/png;base64,dGVzdA==" marks={[]} onChange={onChange} />);
    const image = screen.getByAltText("Screenshot für dein Feedback");
    image.getBoundingClientRect = () => ({ width: 200, height: 100 } as DOMRect);
    fireEvent.load(image);
    const viewport = screen.getByLabelText("Screenshot-Ausschnitt");
    // jsdom does not lay anything out: give the viewport a size and a scroll position that sticks.
    let left = 0; let top = 0;
    Object.defineProperty(viewport, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(viewport, "scrollLeft", { get: () => left, set: (value: number) => { left = value; }, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { get: () => top, set: (value: number) => { top = value; }, configurable: true });
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
    return { viewport, onChange, scroll: () => ({ left, top }) };
  }

  it("zooms with the mouse wheel and keeps the point under the cursor", () => {
    const { viewport, scroll } = mounted();
    const notPrevented = fireEvent.wheel(viewport, { deltaY: -100, clientX: 100, clientY: 50 });
    expect(notPrevented).toBe(false);
    const zoom = Number(screen.getByTestId("pointout-zoom-level").textContent?.replace(/\D/g, "")) / 100;
    expect(zoom).toBeGreaterThan(1);
    // The centre of the picture (100, 50) still sits under the cursor (100, 50).
    expect(scroll().left + 100).toBeCloseTo(100 * zoom, 0);
    expect(scroll().top + 50).toBeCloseTo(50 * zoom, 0);
  });

  it("stops at 400 % and lets the page scroll once there is nothing left to zoom out", () => {
    const { viewport } = mounted();
    for (let index = 0; index < 30; index += 1) fireEvent.wheel(viewport, { deltaY: -100, clientX: 10, clientY: 10 });
    expect(screen.getByTestId("pointout-zoom-level").textContent).toContain("400 %");
    for (let index = 0; index < 60; index += 1) fireEvent.wheel(viewport, { deltaY: 100, clientX: 10, clientY: 10 });
    expect(screen.getByTestId("pointout-zoom-level").textContent).toContain("100 %");
    expect(fireEvent.wheel(viewport, { deltaY: 100, clientX: 10, clientY: 10 })).toBe(true);
  });

  it("zooms the trackpad pinch (ctrl + wheel) in finer steps than a wheel notch", () => {
    const { viewport } = mounted();
    fireEvent.wheel(viewport, { deltaY: -4, ctrlKey: true, clientX: 100, clientY: 50 });
    const pinch = Number(screen.getByTestId("pointout-zoom-level").textContent?.replace(/\D/g, ""));
    expect(pinch).toBeGreaterThan(100);
    expect(pinch).toBeLessThan(150);
  });

  it("pans with the middle mouse button whichever tool is chosen, without drawing", () => {
    const { onChange, scroll } = mounted();
    fireEvent.click(screen.getByRole("button", { name: "Vergrößern" }));
    const surface = screen.getByRole("img", { name: "Screenshot markieren" });
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 } as DOMRect);
    const before = scroll();
    pointer(surface, "pointerdown", { pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 50, button: 1 } as never);
    pointer(surface, "pointermove", { pointerId: 1, pointerType: "mouse", clientX: 60, clientY: 40 });
    pointer(surface, "pointerup", { pointerId: 1, pointerType: "mouse", clientX: 60, clientY: 40 });
    expect(scroll()).toEqual({ left: before.left + 40, top: before.top + 10 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
