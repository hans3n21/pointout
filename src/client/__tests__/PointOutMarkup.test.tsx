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
});
