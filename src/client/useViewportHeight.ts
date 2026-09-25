"use client";

import { useEffect } from "react";

let subscribers = 0;
let observedViewport: VisualViewport | null = null;

function applyHeight() {
  if (!observedViewport) return;
  document.documentElement.style.setProperty("--pointout-height", `${observedViewport.height}px`);
}

/**
 * iOS/Safari kennt `interactive-widget=resizes-content` nicht: Bei geöffneter
 * Tastatur bleibt die Layoutfläche gleich groß, nur der sichtbare Ausschnitt
 * schrumpft. Dieser Hook spiegelt die tatsächlich sichtbare Höhe in die
 * CSS-Variable `--pointout-height`, damit ein Rahmen in Fensterhöhe mitschrumpft
 * statt verschoben zu werden.
 *
 * Einzige Stelle im Code, die `visualViewport` liest. Keine zweite Kopie
 * anlegen. Fehlt die API (Serverdurchlauf, Testumgebung, alte Browser),
 * bleibt die Variable ungesetzt und der CSS-Fallback `100dvh` greift.
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    if (subscribers === 0) {
      observedViewport = viewport;
      viewport.addEventListener("resize", applyHeight);
      viewport.addEventListener("scroll", applyHeight);
    }
    subscribers += 1;
    applyHeight();

    return () => {
      subscribers -= 1;
      if (subscribers === 0) {
        observedViewport?.removeEventListener("resize", applyHeight);
        observedViewport?.removeEventListener("scroll", applyHeight);
        observedViewport = null;
        document.documentElement.style.removeProperty("--pointout-height");
      }
    };
  }, []);
}
