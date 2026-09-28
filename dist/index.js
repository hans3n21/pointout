"use client";
// src/client/PointOutWidget.tsx
import { useCallback as useCallback2, useEffect as useEffect4, useRef as useRef3, useState as useState3, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ClipboardPaste, ImagePlus, Loader2, MessageSquarePlus, Mic, RotateCcw, Square, X } from "lucide-react";

// src/client/useViewportHeight.ts
import { useEffect } from "react";
var subscribers = 0;
var observedViewport = null;
function applyHeight() {
  if (!observedViewport) return;
  document.documentElement.style.setProperty("--pointout-height", `${observedViewport.height}px`);
}
function useViewportHeight() {
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

// src/client/cn.ts
function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

// src/client/useDictation.ts
import { useCallback, useEffect as useEffect2, useRef, useState } from "react";

// src/core/liveTranscription.ts
function startLiveTranscription(stream, onText, url) {
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("transcription");
  const abort = new AbortController();
  let closed = false;
  let finishing = false;
  let finalText = null;
  let partial = "";
  let commitTimer;
  let finishTimer;
  let resolveFinish;
  let finishPromise;
  let resolveOpen;
  const opened = new Promise((resolve) => {
    resolveOpen = resolve;
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(commitTimer);
    clearTimeout(finishTimer);
    clearTimeout(setupTimer);
    abort.abort();
    channel.onmessage = null;
    channel.onclose = null;
    peer.onconnectionstatechange = null;
    channel.close();
    peer.close();
    resolveOpen?.(false);
    resolveFinish?.(finalText);
  };
  const setupTimer = setTimeout(close, 1e4);
  channel.onopen = () => resolveOpen?.(true);
  channel.onclose = close;
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") close();
  };
  channel.onmessage = (message) => {
    if (closed) return;
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") {
      close();
    } else if (event.type === "conversation.item.input_audio_transcription.delta" && typeof event.delta === "string") {
      partial += event.delta;
      onText(partial);
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
      finalText = event.transcript.trim();
      onText(finalText);
      if (finishing) close();
    }
  };
  const ready = (async () => {
    try {
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const offer = await peer.createOffer();
      if (closed) return false;
      await peer.setLocalDescription(offer);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
        signal: abort.signal
      });
      if (!response.ok) throw new Error("Live transcription unavailable");
      const sdp = await response.text();
      if (closed) return false;
      await peer.setRemoteDescription({ type: "answer", sdp });
      const connected = channel.readyState === "open" || await opened;
      if (connected && !closed) clearTimeout(setupTimer);
      return connected && !closed;
    } catch {
      close();
      return false;
    }
  })();
  return {
    ready,
    cancel: close,
    finish() {
      if (finishPromise) return finishPromise;
      if (closed) return Promise.resolve(null);
      finishing = true;
      finishPromise = new Promise((resolve) => {
        resolveFinish = resolve;
      });
      commitTimer = setTimeout(() => {
        if (closed) return;
        if (channel.readyState !== "open") {
          close();
          return;
        }
        channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }, 300);
      finishTimer = setTimeout(close, 12e3);
      if (finalText !== null) close();
      return finishPromise;
    }
  };
}

// src/core/recording.ts
var VOICE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus"
];
function selectVoiceMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
function audioFileExtension(mimeType) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
function getVoiceErrorMessage(error) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Mikrofonzugriff wurde blockiert. Bitte erlaube das Mikrofon im Browser oder nutze die Diktierfunktion deiner Handy-Tastatur.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Kein Mikrofon gefunden. Pr\xFCfe die Mikrofonfreigabe oder nutze die Tastatur-Diktierfunktion.";
  }
  return "Spracheingabe ist auf diesem Ger\xE4t gerade nicht verf\xFCgbar. Nutze alternativ die Diktierfunktion deiner Handy-Tastatur.";
}

// src/client/useDictation.ts
var TRANSCRIPTION_FAILED = "Die Aufnahme konnte nicht in Text umgewandelt werden. Bitte versuche es erneut.";
function useDictation(onText, transcribeUrl, liveTranscribeUrl) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [liveText, setLiveText] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const liveRef = useRef(null);
  const onTextRef = useRef(onText);
  useEffect2(() => {
    onTextRef.current = onText;
  }, [onText]);
  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);
  useEffect2(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    liveRef.current?.cancel();
    liveRef.current = null;
    release();
  }, [release]);
  const transcribe = async (audio) => {
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", audio, `feedback.${audioFileExtension(audio.type || "audio/webm")}`);
      const response = await fetch(transcribeUrl, { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.text?.trim()) throw new Error(data.error ?? TRANSCRIPTION_FAILED);
      onTextRef.current(data.text.trim());
    } catch {
      setError(TRANSCRIPTION_FAILED);
    } finally {
      setPhase("idle");
    }
  };
  const start = async () => {
    if (phase !== "idle") return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Spracheingabe wird von diesem Browser nicht unterst\xFCtzt. Nutze alternativ die Diktierfunktion deiner Handy-Tastatur.");
      return;
    }
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true }
      });
      streamRef.current = stream;
      const mimeType = selectVoiceMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64e3 } : void 0);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        const live = liveRef.current;
        liveRef.current = null;
        const liveResult = live?.finish();
        release();
        recorderRef.current = null;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        setPhase("transcribing");
        const text = await liveResult;
        setLiveText("");
        if (text) {
          onTextRef.current(text);
          setPhase("idle");
          return;
        }
        if (audio.size === 0) {
          setPhase("idle");
          setError("Ich habe keine Aufnahme erhalten. Bitte versuche es erneut.");
          return;
        }
        void transcribe(audio);
      };
      recorder.onerror = () => {
        liveRef.current?.cancel();
        liveRef.current = null;
        setLiveText("");
        release();
        recorderRef.current = null;
        setPhase("idle");
        setError("Die Aufnahme ist abgebrochen. Bitte versuche es erneut.");
      };
      recorderRef.current = recorder;
      if (liveTranscribeUrl && typeof RTCPeerConnection !== "undefined") {
        try {
          setLiveText("");
          const live = startLiveTranscription(stream, setLiveText, liveTranscribeUrl);
          liveRef.current = live;
          if (!await live.ready) {
            live.cancel();
            liveRef.current = null;
          }
        } catch {
          liveRef.current = null;
        }
      }
      if (streamRef.current !== stream) return;
      recorder.start();
      setPhase("recording");
    } catch (cause) {
      liveRef.current?.cancel();
      liveRef.current = null;
      release();
      setPhase("idle");
      setError(getVoiceErrorMessage(cause));
    }
  };
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);
  return { phase, error, liveText, start, stop };
}

// src/core/annotation.ts
function normalizePoint(clientX, clientY, rect) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height))
  };
}
function arrowHead(from, tip) {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const length = 0.04;
  const spread = Math.PI / 6;
  return [
    { x: tip.x - Math.cos(angle + spread) * length, y: tip.y - Math.sin(angle + spread) * length },
    { x: tip.x - Math.cos(angle - spread) * length, y: tip.y - Math.sin(angle - spread) * length }
  ];
}
function drawMarks(context, marks, width, height) {
  context.strokeStyle = "#f43f5e";
  context.lineWidth = Math.max(3, Math.min(width, height) * 6e-3);
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

// src/core/capture.ts
var MAX_IMAGE_BYTES = 6 * 1024 * 1024;
var MAX_SOURCE_BYTES = 20 * 1024 * 1024;
var IMAGE_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp"]);
var SCROLL_MARK = "data-pointout-scroll";
var FIXED_MARK = "data-pointout-fixed";
var RASTER_MARK = "data-pointout-raster";
var XLINK = "http://www.w3.org/1999/xlink";
function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function paintSvg(svg, width, height) {
  const copy = svg.cloneNode(true);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const liveParts = Array.from(svg.querySelectorAll("*"));
  Array.from(copy.querySelectorAll("*")).forEach((part, index) => {
    const style = getComputedStyle(liveParts[index]);
    for (const property of ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity"]) {
      part.style.setProperty(property, style.getPropertyValue(property));
    }
  });
  for (const image of Array.from(copy.querySelectorAll("image"))) {
    const href = image.getAttribute("href") ?? image.getAttributeNS(XLINK, "href");
    if (!href || href.startsWith("data:")) continue;
    const response = await fetch(new URL(href, document.baseURI).href);
    if (!response.ok) throw new Error(`Bild ${response.status}`);
    image.setAttribute("href", await readAsDataUrl(await response.blob()));
    image.removeAttributeNS(XLINK, "href");
  }
  const picture = new Image();
  picture.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  canvas.getContext("2d")?.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
async function paintPictureSvgs(rasterize) {
  const images = [];
  const marked = [];
  for (const svg of Array.from(document.body.querySelectorAll("svg"))) {
    if (!svg.querySelector("image") || svg.parentElement?.closest("svg")) continue;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) continue;
    try {
      images.push(await rasterize(svg, rect.width, rect.height));
    } catch {
      continue;
    }
    svg.setAttribute(RASTER_MARK, `${images.length - 1},${rect.width},${rect.height}`);
    marked.push(svg);
  }
  return { images, clear: () => marked.forEach((svg) => svg.removeAttribute(RASTER_MARK)) };
}
async function shrinkToScreen(url) {
  if (url.startsWith("data:")) return false;
  const picture = new Image();
  picture.crossOrigin = "anonymous";
  picture.src = new URL(url, document.baseURI).href;
  try {
    await picture.decode();
  } catch {
    return false;
  }
  const limit = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  const scale = limit / Math.max(picture.naturalWidth, picture.naturalHeight);
  if (!picture.naturalWidth || !picture.naturalHeight || scale >= 1) return false;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(picture, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/webp", 0.9);
  } catch {
    return false;
  }
}
var CSS_URL = /url\((['"]?)([^'"]+?)\1\)/g;
async function embedPseudoPictures(svg, shrink) {
  for (const sheet of Array.from(svg.querySelectorAll("style"))) {
    const css = sheet.textContent ?? "";
    const links = new Set(Array.from(css.matchAll(CSS_URL), (match) => match[2]).filter((link) => !link.startsWith("data:")));
    let embedded = css;
    for (const link of links) {
      try {
        const data = await shrink(link) || await fetch(new URL(link, document.baseURI).href).then((response) => {
          if (!response.ok) throw new Error(`Bild ${response.status}`);
          return response.blob();
        }).then(readAsDataUrl);
        embedded = embedded.replace(CSS_URL, (whole, quote, found) => found === link ? `url(${quote}${data}${quote})` : whole);
      } catch {
      }
    }
    if (embedded !== css) sheet.textContent = embedded;
  }
}
function isUniformImage(pixels, tolerance = 8) {
  for (let index = 4; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(pixels[index + channel] - pixels[channel]) > tolerance) return false;
    }
  }
  return true;
}
async function looksBlank(dataUrl) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Screenshot konnte nicht gepr\xFCft werden."));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return isUniformImage(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
function pageBackground() {
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  const rootBackground = getComputedStyle(document.documentElement).backgroundColor;
  return [bodyBackground, rootBackground].find(
    (color) => color && color !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/.test(color)
  ) ?? "#ffffff";
}
function shift(element, left, top) {
  const current = element.style.transform;
  const offset = `translate(${-left}px, ${-top}px)`;
  element.style.transform = current && current !== "none" ? `${offset} ${current}` : offset;
}
function markLayout() {
  const marked = [];
  const scroller = document.scrollingElement ?? document.documentElement;
  const page = { left: scroller.scrollLeft, top: scroller.scrollTop };
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (element.scrollTop > 0 || element.scrollLeft > 0) {
      element.setAttribute(SCROLL_MARK, `${element.scrollLeft},${element.scrollTop}`);
      marked.push(element);
    }
  }
  if (page.left || page.top) {
    const body = document.body.getBoundingClientRect();
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (getComputedStyle(element).position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      element.setAttribute(FIXED_MARK, [rect.left - body.left, rect.top - body.top, rect.width, rect.height].join(","));
      marked.push(element);
    }
  }
  return {
    page,
    clear: () => marked.forEach((element) => {
      element.removeAttribute(SCROLL_MARK);
      element.removeAttribute(FIXED_MARK);
    })
  };
}
function prepareCopy(root, page, painted) {
  root.querySelectorAll(`[${RASTER_MARK}]`).forEach((svg) => {
    const [index, width, height] = (svg.getAttribute(RASTER_MARK) ?? "").split(",").map(Number);
    const picture = svg.ownerDocument.createElement("img");
    picture.setAttribute("style", svg.getAttribute("style") ?? "");
    picture.setAttribute("class", svg.getAttribute("class") ?? "");
    picture.src = painted[index];
    picture.alt = "";
    Object.assign(picture.style, { width: `${width}px`, height: `${height}px` });
    svg.replaceWith(picture);
  });
  root.querySelectorAll("[data-pointout-private]").forEach((element) => {
    element.style.visibility = "hidden";
  });
  root.querySelectorAll("input[type=password], input[autocomplete=current-password], input[autocomplete=one-time-code]").forEach((input) => {
    input.value = "";
    input.setAttribute("value", "");
  });
  root.querySelectorAll(`[${SCROLL_MARK}]`).forEach((panel) => {
    const [left, top] = (panel.getAttribute(SCROLL_MARK) ?? "0,0").split(",").map(Number);
    panel.removeAttribute(SCROLL_MARK);
    panel.style.overflow = "hidden";
    Array.from(panel.children).forEach((child) => shift(child, left, top));
  });
  if (page.left || page.top) {
    Array.from(root.children).forEach((child) => shift(child, page.left, page.top));
    root.querySelectorAll(`[${FIXED_MARK}]`).forEach((bar) => {
      const [left, top, width, height] = (bar.getAttribute(FIXED_MARK) ?? "").split(",").map(Number);
      bar.removeAttribute(FIXED_MARK);
      Object.assign(bar.style, { top: `${top}px`, left: `${left}px`, bottom: "auto", right: "auto", width: `${width}px`, height: `${height}px`, margin: "0", transform: "none" });
    });
  }
}
async function drawWithBrowser(backgroundColor, rasterizeSvg, shrinkPicture) {
  const { domToPng } = await import("modern-screenshot");
  const pictures = await paintPictureSvgs(rasterizeSvg);
  const layout = markLayout();
  try {
    return await domToPng(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      backgroundColor,
      timeout: 4e3,
      fetchFn: shrinkPicture,
      filter: (node) => !(node instanceof Element && node.hasAttribute("data-feedback-screenshot-ignore")),
      onCloneNode: (root) => {
        if (root instanceof Element) prepareCopy(root, layout.page, pictures.images);
      },
      onCreateForeignObjectSvg: (svg) => embedPseudoPictures(svg, shrinkPicture)
    });
  } finally {
    layout.clear();
    pictures.clear();
  }
}
async function captureAppScreen({ isBlank = looksBlank, rasterizeSvg = paintSvg, shrinkPicture = shrinkToScreen } = {}) {
  const sourceCanvases = Array.from(document.querySelectorAll("canvas"));
  const bitmaps = sourceCanvases.map((source) => {
    const rect = source.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight || source.closest("[data-feedback-screenshot-ignore]")) return null;
    try {
      return source.toDataURL("image/png");
    } catch {
      throw new Error("Canvas-Inhalt konnte nicht sicher erfasst werden. Bitte w\xE4hle einen echten Screenshot aus.");
    }
  });
  const backgroundColor = pageBackground();
  try {
    const drawn = await drawWithBrowser(backgroundColor, rasterizeSvg, shrinkPicture);
    if (drawn.startsWith("data:image/png;base64,") && !await isBlank(drawn)) return checked(drawn);
  } catch {
  }
  const { default: html2canvas } = await import("html2canvas-pro");
  const canvas = await html2canvas(document.documentElement, {
    backgroundColor,
    useCORS: true,
    allowTaint: false,
    scale: 1,
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    ignoreElements: (element) => element.hasAttribute("data-feedback-screenshot-ignore"),
    onclone: (clonedDocument) => {
      Array.from(clonedDocument.querySelectorAll("canvas")).forEach((clonedCanvas, index) => {
        const bitmap = bitmaps[index];
        if (!bitmap) return;
        const image = clonedDocument.createElement("img");
        image.src = bitmap;
        image.width = clonedCanvas.width;
        image.height = clonedCanvas.height;
        image.style.cssText = clonedCanvas.style.cssText;
        image.className = clonedCanvas.className;
        clonedCanvas.replaceWith(image);
      });
      clonedDocument.querySelectorAll("input[type=password], input[autocomplete=current-password], input[autocomplete=one-time-code]").forEach((input) => {
        input.value = "";
        input.setAttribute("value", "");
      });
      clonedDocument.querySelectorAll("[data-pointout-private]").forEach((element) => {
        element.style.visibility = "hidden";
      });
    }
  });
  return checked(canvas.toDataURL("image/png"));
}
function checked(dataUrl) {
  if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 8e6) {
    throw new Error("Screenshot konnte nicht gespeichert werden. Bitte w\xE4hle ein Bild aus.");
  }
  return { dataUrl };
}
async function readManualScreenshot(file) {
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("Bitte w\xE4hle einen Screenshot oder ein Bild aus.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Das Bild ist zu gro\xDF (maximal 20 MB).");
  if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
    const source = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Das Bildformat konnte nicht ge\xF6ffnet werden. Bitte w\xE4hle einen PNG- oder JPEG-Screenshot aus."));
        image.src = source;
      });
      for (const size of [1600, 1200, 900]) {
        const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Dieses Ger\xE4t kann das Bild nicht verarbeiten.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        if (dataUrl.length <= 8e6) return dataUrl;
      }
      throw new Error("Das Bild ist nach der Verkleinerung noch zu gro\xDF.");
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}
async function flattenAnnotations(dataUrl, marks) {
  if (marks.length === 0) return dataUrl;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Das markierte Bild konnte nicht verarbeitet werden."));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Bildverarbeitung wird von diesem Browser nicht unterst\xFCtzt.");
  context.drawImage(image, 0, 0);
  drawMarks(context, marks, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

// src/core/deviceContext.ts
function safePageUrl(href) {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "/";
  }
}
function fallbackFromUserAgent(ua) {
  const browserMatch = /(Edg|OPR|CriOS|FxiOS|Chrome|Firefox|Version)\/([\d.]+)/.exec(ua);
  const browserNames = { Edg: "Edge", OPR: "Opera", CriOS: "Chrome", FxiOS: "Firefox", Version: "Safari" };
  const os = /(?:Android\s([\d.]+))|(?:(?:iPhone|iPad).*?OS\s([\d_]+))|(?:Windows NT\s([\d.]+))|(?:Mac OS X\s([\d_.]+))/.exec(ua);
  const osName = os?.[1] ? "Android" : os?.[2] ? "iOS" : os?.[3] ? "Windows" : os?.[4] ? "macOS" : null;
  const osVersion = os?.slice(1).find(Boolean)?.replaceAll("_", ".") ?? null;
  return {
    browser: browserMatch ? browserNames[browserMatch[1]] ?? browserMatch[1] : null,
    browserVersion: browserMatch?.[2] ?? null,
    osName,
    osVersion
  };
}
async function collectDeviceContext(env = window) {
  const nav = env.navigator;
  const ua = nav.userAgent ?? "";
  const fallback = fallbackFromUserAgent(ua);
  const hints = nav.userAgentData;
  let high = {};
  try {
    high = await hints?.getHighEntropyValues?.(["platformVersion", "fullVersionList"]) ?? {};
  } catch {
  }
  const usefulBrand = (high.fullVersionList ?? hints?.brands ?? []).find((item) => !/Not.A.Brand|Chromium/i.test(item.brand)) ?? (high.fullVersionList ?? hints?.brands ?? []).find((item) => /Chromium/i.test(item.brand));
  const isTablet = /iPad|Tablet/i.test(ua) || hints?.mobile === false && (nav.maxTouchPoints ?? 0) > 0 && Math.min(env.screen.width, env.screen.height) < 900;
  const isMobile = hints?.mobile ?? /iPhone|Android.*Mobile|Mobile/i.test(ua);
  return {
    page_url: safePageUrl(env.location.href),
    route: env.location.pathname,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    browser: usefulBrand?.brand ?? fallback.browser,
    browser_version: usefulBrand?.version ?? fallback.browserVersion,
    operating_system: hints?.platform ?? fallback.osName,
    operating_system_version: high.platformVersion || fallback.osVersion,
    device_type: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
    viewport: { width: env.innerWidth, height: env.innerHeight },
    screen_size: { width: env.screen.width, height: env.screen.height },
    pixel_ratio: env.devicePixelRatio || 1,
    touch_enabled: (nav.maxTouchPoints ?? 0) > 0,
    display_mode: env.matchMedia?.("(display-mode: standalone)").matches || nav.standalone ? "standalone" : "browser",
    orientation: env.innerHeight > env.innerWidth ? "portrait" : "landscape",
    aspect_ratio: Math.round(env.innerWidth / env.innerHeight * 100) / 100,
    color_scheme: env.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    language: nav.language ?? null,
    scroll: typeof env.scrollY === "number" && env.document ? { y: Math.round(env.scrollY), height: env.document.documentElement.scrollHeight } : null
  };
}

// src/core/steps.ts
var CONTROLS = [
  "button",
  "a[href]",
  "summary",
  "select",
  "input[type=checkbox]",
  "input[type=radio]",
  "input[type=submit]",
  "input[type=button]",
  ...["button", "tab", "link", "menuitem", "switch", "checkbox", "radio", "option"].map((role) => `[role=${role}]`)
].join(",");
function short(text, max) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "\u2026" : clean;
}
function labelOf(element) {
  const labelled = element;
  return short(
    element.getAttribute("aria-label") || labelled.labels?.[0]?.textContent || element.textContent || element.getAttribute("title") || element.tagName.toLowerCase(),
    60
  );
}
function areaOf(element) {
  const area = element.parentElement?.closest("[data-pointout-area], [aria-label]");
  const text = area?.getAttribute("data-pointout-area") ?? area?.getAttribute("aria-label");
  return text ? short(text, 60) : void 0;
}
function requestTarget(raw, base) {
  try {
    const url = new URL(raw, base);
    return url.host + url.pathname;
  } catch {
    return short(raw.split(/[?#]/, 1)[0], 120);
  }
}
function startStepRecorder({
  target = window,
  now = () => Date.now(),
  maxSteps = 20,
  maxAgeMs = 3 * 6e4,
  ignoreUrls = []
} = {}) {
  let steps = [];
  let active = true;
  const ignored = new Set(ignoreUrls.map((url) => requestTarget(url, target.location.href)));
  function add(kind, label, area) {
    if (!active || !label) return;
    const at = now();
    const route = target.location.pathname;
    const index = kind === "click" ? steps.length && steps[steps.length - 1].kind === "click" && steps[steps.length - 1].label === label && steps[steps.length - 1].area === area ? steps.length - 1 : -1 : steps.findIndex((step) => step.kind === kind && step.label === label);
    if (index >= 0) {
      const [existing] = steps.splice(index, 1);
      steps.push({ ...existing, at, route, count: existing.count + 1 });
    } else {
      steps.push({ kind, label, area, route, at, count: 1 });
    }
    if (steps.length > maxSteps) steps = steps.slice(-maxSteps);
  }
  const onClick = (event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const control = origin?.closest(CONTROLS);
    if (!control || control.closest("[data-pointout-private], [data-pointout-root]")) return;
    add("click", labelOf(control), areaOf(control));
  };
  const onError = (event) => {
    const file = event.filename ? event.filename.split(/[?#]/, 1)[0].split("/").pop() : "";
    add("error", short(event.message || "Unbekannter Fehler", 160) + (file ? ` (${file}:${event.lineno})` : ""));
  };
  const onRejection = (event) => {
    const reason = event.reason;
    add("error", short(reason instanceof Error ? reason.message : String(reason), 160));
  };
  const originalFetch = target.fetch;
  const recordingFetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const where = requestTarget(raw, target.location.href);
    const record = !ignored.has(where);
    try {
      const response = await originalFetch.call(target, input, init);
      if (record && !response.ok) add("request", `${method} ${where} \u2192 ${response.status}`);
      return response;
    } catch (cause) {
      if (record && !(cause instanceof DOMException && cause.name === "AbortError")) add("request", `${method} ${where} \u2192 Netzwerkfehler`);
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
      if (target.fetch === recordingFetch) target.fetch = originalFetch;
    }
  };
}
function toSentSteps(steps, openedAt) {
  return steps.map(({ kind, label, area, route, at, count }) => ({
    seconds_before: Math.max(0, Math.round((openedAt - at) / 1e3)),
    kind,
    label,
    ...area ? { area } : {},
    route,
    ...count > 1 ? { count } : {}
  }));
}

// src/client/PointOutMarkup.tsx
import { useEffect as useEffect3, useLayoutEffect, useRef as useRef2, useState as useState2 } from "react";
import { ArrowUpRight, Circle, Eraser, Hand, Minus, Pencil, Plus, RectangleHorizontal, Undo2 } from "lucide-react";
import { jsx, jsxs } from "react/jsx-runtime";
var TOOLS = [
  { id: "freehand", label: "Freihand", icon: Pencil },
  { id: "rectangle", label: "Rechteck", icon: RectangleHorizontal },
  { id: "circle", label: "Kreis", icon: Circle },
  { id: "arrow", label: "Pfeil", icon: ArrowUpRight }
];
var PRESS = "po:transition po:duration-150 po:active:scale-[0.94] po:focus-visible:outline-2 po:focus-visible:outline-violet-300";
var ACTIVE = "po:bg-rose-500 po:text-white po:shadow-[0_0_16px_rgba(244,63,94,0.45)]";
var IDLE = "po:text-zinc-300 po:hover:bg-white/10";
function Mark({ mark }) {
  const first = mark.points[0];
  if (!first) return null;
  const last = mark.points.at(-1) ?? first;
  const x1 = first.x * 1e3;
  const y1 = first.y * 1e3;
  const x2 = last.x * 1e3;
  const y2 = last.y * 1e3;
  const shared = { fill: "none", stroke: "#f43f5e", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" };
  if (mark.tool === "freehand") {
    return /* @__PURE__ */ jsx("polyline", { ...shared, points: mark.points.map((point) => `${point.x * 1e3},${point.y * 1e3}`).join(" ") });
  }
  if (mark.tool === "rectangle") {
    return /* @__PURE__ */ jsx("rect", { ...shared, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
  }
  if (mark.tool === "circle") {
    return /* @__PURE__ */ jsx("ellipse", { ...shared, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 });
  }
  const [a, b] = arrowHead(first, last);
  return /* @__PURE__ */ jsx("path", { ...shared, d: `M ${x1} ${y1} L ${x2} ${y2} M ${a.x * 1e3} ${a.y * 1e3} L ${x2} ${y2} L ${b.x * 1e3} ${b.y * 1e3}` });
}
function PointOutMarkup({ screenshot, marks, onChange }) {
  const [tool, setTool] = useState2("freehand");
  const [draft, setDraft] = useState2(null);
  const [zoom, setZoom] = useState2(1);
  const [baseSize, setBaseSize] = useState2(null);
  const [previousScreenshot, setPreviousScreenshot] = useState2(screenshot);
  const imageRef = useRef2(null);
  const viewportRef = useRef2(null);
  const zoomRef = useRef2(1);
  const activePointer = useRef2(null);
  const draftRef = useRef2(null);
  const panRef = useRef2(null);
  const touchesRef = useRef2(/* @__PURE__ */ new Map());
  const gestureRef = useRef2(false);
  const pinchRef = useRef2(null);
  if (previousScreenshot !== screenshot) {
    setPreviousScreenshot(screenshot);
    setZoom(1);
    setBaseSize(null);
  }
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect3(() => {
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
  function limitZoom(value) {
    return Math.max(1, Math.min(4, Math.round(value * 100) / 100));
  }
  function horizontalOffset(level) {
    const viewport = viewportRef.current;
    return viewport && baseSize ? Math.max(0, (viewport.clientWidth - baseSize.width * level) / 2) : 0;
  }
  function setZoomAt(value, anchorX, anchorY) {
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
  function zoomBy(step) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setZoomAt(zoomRef.current + step, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }
  function pinchPoints() {
    return Array.from(touchesRef.current.values()).slice(0, 2);
  }
  function pinchCenter(points) {
    const viewport = viewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    return {
      x: (points[0].x + points[1].x) / 2 - (rect?.left ?? 0),
      y: (points[0].y + points[1].y) / 2 - (rect?.top ?? 0),
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    };
  }
  function point(event) {
    return normalizePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }
  function start(event) {
    if (event.pointerType === "touch") {
      if (touchesRef.current.size >= 2) {
        event.preventDefault();
        return;
      }
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
          distance: Math.max(1, center.distance),
          zoom: zoomRef.current,
          x: ((viewport?.scrollLeft ?? 0) + center.x - horizontalOffset(zoomRef.current)) / zoomRef.current,
          y: ((viewport?.scrollTop ?? 0) + center.y) / zoomRef.current
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
      panRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport?.scrollLeft ?? 0,
        top: viewport?.scrollTop ?? 0
      };
      return;
    }
    const next = { tool, points: [point(event)] };
    draftRef.current = next;
    setDraft(next);
  }
  function move(event) {
    if (event.pointerType === "touch" && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gestureRef.current && pinchRef.current && touchesRef.current.size >= 2) {
        event.preventDefault();
        const center = pinchCenter(pinchPoints());
        const start2 = pinchRef.current;
        const next2 = limitZoom(start2.zoom * center.distance / start2.distance);
        zoomRef.current = next2;
        setZoom(next2);
        window.requestAnimationFrame(() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          viewport.scrollLeft = start2.x * next2 + horizontalOffset(next2) - center.x;
          viewport.scrollTop = start2.y * next2 - center.y;
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
  function finish(event) {
    const wasGesture = gestureRef.current;
    if (event.pointerType === "touch") {
      touchesRef.current.delete(event.pointerId);
      if (touchesRef.current.size < 2) pinchRef.current = null;
      if (touchesRef.current.size === 0) gestureRef.current = false;
    }
    if (wasGesture) {
      event.preventDefault();
      return;
    }
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
  function cancel(event) {
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
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("div", { ref: viewportRef, className: "po:max-h-[36dvh] po:overflow-auto po:sm:max-h-[40dvh] po:rounded-2xl po:bg-black/40 po:ring-1 po:ring-white/10", "aria-label": "Screenshot-Ausschnitt", children: /* @__PURE__ */ jsx(
      "div",
      {
        "data-testid": "pointout-zoom-surface",
        className: "po:relative po:mx-auto",
        style: baseSize ? { width: `${baseSize.width * zoom}px`, height: `${baseSize.height * zoom}px` } : { width: "fit-content" },
        children: /* @__PURE__ */ jsxs("div", { className: "po:relative", style: baseSize ? { width: `${baseSize.width}px`, height: `${baseSize.height}px`, transform: `scale(${zoom})`, transformOrigin: "top left" } : void 0, children: [
          /* @__PURE__ */ jsx("img", { ref: imageRef, src: screenshot, alt: "Screenshot f\xFCr dein Feedback", onLoad: measureImage, className: "po:block po:max-h-[36dvh] po:max-w-full po:sm:max-h-[40dvh]" }),
          /* @__PURE__ */ jsxs(
            "svg",
            {
              role: "img",
              "aria-label": "Screenshot markieren",
              viewBox: "0 0 1000 1000",
              preserveAspectRatio: "none",
              className: cn("po:absolute po:inset-0 po:h-full po:w-full po:touch-none", tool === "pan" ? "po:cursor-grab" : "po:cursor-crosshair"),
              onPointerDown: start,
              onPointerMove: move,
              onPointerUp: finish,
              onPointerCancel: cancel,
              children: [
                marks.map((mark, index) => /* @__PURE__ */ jsx(Mark, { mark }, index)),
                draft ? /* @__PURE__ */ jsx(Mark, { mark: draft }) : null
              ]
            }
          )
        ] })
      }
    ) }),
    /* @__PURE__ */ jsxs("div", { className: "po:mt-3 po:flex po:flex-wrap po:items-center po:gap-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "po:flex po:min-w-0 po:flex-1 po:basis-full po:gap-1 po:rounded-2xl po:bg-white/[0.05] po:p-1 po:ring-1 po:ring-white/10 po:sm:basis-auto", role: "toolbar", "aria-label": "Markierungswerkzeuge", children: [
        TOOLS.map(({ id, label, icon: Icon }) => /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            "aria-label": label,
            title: label,
            "aria-pressed": tool === id,
            onClick: () => setTool(id),
            className: cn(PRESS, "po:flex po:min-h-11 po:min-w-11 po:flex-1 po:items-center po:justify-center po:gap-1.5 po:rounded-xl po:px-2 po:text-xs", tool === id ? ACTIVE : IDLE),
            children: /* @__PURE__ */ jsx(Icon, { className: "po:h-5 po:w-5" })
          },
          id
        )),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            "aria-label": "Verschieben",
            title: "Verschieben",
            "aria-pressed": tool === "pan",
            onClick: () => setTool("pan"),
            className: cn(PRESS, "po:flex po:min-h-11 po:min-w-11 po:flex-1 po:items-center po:justify-center po:rounded-xl", tool === "pan" ? ACTIVE : IDLE),
            children: /* @__PURE__ */ jsx(Hand, { className: "po:h-5 po:w-5" })
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "po:flex po:flex-1 po:items-center po:justify-between po:gap-2 po:sm:flex-none", children: [
        /* @__PURE__ */ jsxs("div", { className: "po:flex po:gap-1 po:rounded-2xl po:bg-white/[0.05] po:p-1 po:ring-1 po:ring-white/10", children: [
          /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "R\xFCckg\xE4ngig", title: "R\xFCckg\xE4ngig", disabled: marks.length === 0, onClick: () => onChange(marks.slice(0, -1)), className: cn(PRESS, IDLE, "po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-xl po:disabled:opacity-35"), children: /* @__PURE__ */ jsx(Undo2, { className: "po:h-5 po:w-5" }) }),
          /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Markierungen l\xF6schen", title: "Markierungen l\xF6schen", disabled: marks.length === 0, onClick: () => onChange([]), className: cn(PRESS, IDLE, "po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-xl po:disabled:opacity-35"), children: /* @__PURE__ */ jsx(Eraser, { className: "po:h-5 po:w-5" }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { role: "group", "aria-label": "Zoom", className: "po:flex po:items-center po:gap-1 po:rounded-2xl po:bg-white/[0.05] po:p-1 po:ring-1 po:ring-white/10", children: [
          /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Verkleinern", disabled: zoom <= 1, onClick: () => zoomBy(-0.5), className: cn(PRESS, IDLE, "po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-xl po:disabled:opacity-35"), children: /* @__PURE__ */ jsx(Minus, { className: "po:h-5 po:w-5" }) }),
          /* @__PURE__ */ jsxs("span", { "data-testid": "pointout-zoom-level", className: "po:min-w-12 po:text-center po:text-xs po:tabular-nums po:text-zinc-300", children: [
            Math.round(zoom * 100),
            " %"
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Vergr\xF6\xDFern", disabled: zoom >= 4, onClick: () => zoomBy(0.5), className: cn(PRESS, IDLE, "po:flex po:min-h-11 po:min-w-11 po:items-center po:justify-center po:rounded-xl po:disabled:opacity-35"), children: /* @__PURE__ */ jsx(Plus, { className: "po:h-5 po:w-5" }) })
        ] })
      ] })
    ] })
  ] });
}

// src/client/PointOutWidget.tsx
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var CATEGORIES = [
  { value: "bug", label: "Fehler" },
  { value: "idea", label: "Idee" },
  { value: "design", label: "Design" }
];
function stepLine(step) {
  const time = `\u2212${Math.floor(step.seconds_before / 60)}:${String(step.seconds_before % 60).padStart(2, "0")}`;
  const what = step.kind === "click" ? `Klick \u201E${step.label}\u201C${step.area ? ` \xB7 ${step.area}` : ""}` : step.kind === "error" ? `Fehler: ${step.label}` : `Anfrage: ${step.label}`;
  return `${time}  ${what}${step.count ? ` (${step.count}\xD7)` : ""}`;
}
async function readAppContext(context) {
  if (!context) return void 0;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(context),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(void 0), 1e3);
      })
    ]);
  } catch {
    return void 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
var subscribeToNothing = () => () => {
};
function PointOutWidget({
  projectId,
  projectName,
  appVersion = null,
  feedbackUrl = "/api/pointout/feedback",
  transcribeUrl = "/api/pointout/transcribe",
  liveTranscribeUrl = "/api/pointout/transcribe/live",
  sessionId,
  targetType = "page",
  targetRef,
  triggerVariant = "floating",
  context
}) {
  useViewportHeight();
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const captureRun = useRef3(0);
  const [capturing, setCapturing] = useState3(false);
  const [open, setOpen] = useState3(false);
  const pagePath = typeof window === "undefined" ? "/" : window.location.pathname;
  const [previousPagePath, setPreviousPagePath] = useState3(pagePath);
  if (previousPagePath !== pagePath) {
    setPreviousPagePath(pagePath);
    setCapturing(false);
    setOpen(false);
  }
  const [note, setNote] = useState3("");
  const [transcriptOriginal, setTranscriptOriginal] = useState3("");
  const [screenshot, setScreenshot] = useState3(null);
  const [captureSource, setCaptureSource] = useState3(null);
  const [marks, setMarks] = useState3([]);
  const [captureError, setCaptureError] = useState3("");
  const [resumedDraft, setResumedDraft] = useState3(false);
  const [pasteMenu, setPasteMenu] = useState3(false);
  const [saving, setSaving] = useState3(false);
  const [error, setError] = useState3("");
  const [saved, setSaved] = useState3(false);
  const [category, setCategory] = useState3(null);
  const [steps, setSteps] = useState3([]);
  const [sendSteps, setSendSteps] = useState3(true);
  const [showSteps, setShowSteps] = useState3(false);
  const [appContext, setAppContext] = useState3(void 0);
  const recorderRef = useRef3(null);
  const fileRef = useRef3(null);
  const dialogRef = useRef3(null);
  const dictation = useDictation((text) => {
    setTranscriptOriginal((current) => current ? current + "\n" + text : text);
    setNote((current) => current.trim() ? current.trimEnd() + " " + text : text);
  }, transcribeUrl, liveTranscribeUrl);
  const { phase: dictationPhase, stop: stopDictation } = dictation;
  useEffect4(() => {
    captureRun.current += 1;
  }, [pagePath]);
  useEffect4(() => {
    const recorder = startStepRecorder({ ignoreUrls: [feedbackUrl, transcribeUrl, ...liveTranscribeUrl ? [liveTranscribeUrl] : []] });
    recorderRef.current = recorder;
    return () => {
      recorder.stop();
      recorderRef.current = null;
    };
  }, [feedbackUrl, transcribeUrl, liveTranscribeUrl]);
  useEffect4(() => {
    if (!open && dictationPhase === "recording") stopDictation();
  }, [open, dictationPhase, stopDictation]);
  useEffect4(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setSaved(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);
  useEffect4(() => {
    if (!open || capturing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, capturing]);
  async function takeScreenshot() {
    const run = ++captureRun.current;
    setCapturing(true);
    setCaptureError("");
    setResumedDraft(false);
    setScreenshot(null);
    setCaptureSource(null);
    setMarks([]);
    setOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (run !== captureRun.current) return;
    let captureTimer;
    try {
      const result = await Promise.race([
        captureAppScreen(),
        new Promise((_, reject) => {
          captureTimer = setTimeout(() => reject(new Error("Screenshot dauert zu lange. Bitte w\xE4hle ein Bild aus.")), 12e3);
        })
      ]);
      if (run === captureRun.current) {
        setScreenshot(result.dataUrl);
        setCaptureSource("automatic");
        setMarks([]);
      }
    } catch (cause) {
      if (run === captureRun.current) setCaptureError(cause instanceof Error ? cause.message : "Screenshot fehlgeschlagen. Bitte w\xE4hle ein Bild aus.");
    } finally {
      if (captureTimer) clearTimeout(captureTimer);
      if (run === captureRun.current) setCapturing(false);
    }
  }
  function openDialog() {
    setPasteMenu(false);
    if (captureSource === "manual" || error) {
      setResumedDraft(true);
      setOpen(true);
      return;
    }
    setError("");
    const openedAt = Date.now();
    setSteps(toSentSteps(recorderRef.current?.snapshot() ?? [], openedAt));
    setSendSteps(true);
    setShowSteps(false);
    void readAppContext(context).then(setAppContext);
    void takeScreenshot();
  }
  const selectImage = useCallback2(async (file) => {
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
  useEffect4(() => {
    if (!open) return;
    const onPaste = (event) => {
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
      if (!navigator.clipboard?.read) throw new Error("Zwischenablage-Zugriff wird hier nicht unterst\xFCtzt. Nutze bitte \u201EBild ausw\xE4hlen\u201C.");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const mime = item.types.find((type) => type.startsWith("image/"));
        if (!mime) continue;
        const blob = await item.getType(mime);
        const extension = mime.split("/")[1] || "png";
        await selectImage(new File([blob], `clipboard.${extension}`, { type: mime }));
        return;
      }
      throw new Error("In der Zwischenablage ist kein Bild. Nutze bitte \u201EBild ausw\xE4hlen\u201C.");
    } catch (cause) {
      setCaptureError(cause instanceof Error && cause.message.startsWith("In der Zwischenablage") ? cause.message : "Zwischenablage konnte nicht gelesen werden. Nutze Strg+V oder \u201EBild ausw\xE4hlen\u201C.");
    }
  }
  async function saveNote() {
    if (!note.trim() || saving || capturing || dictation.phase !== "idle") return;
    setSaving(true);
    setError("");
    try {
      const context2 = await collectDeviceContext();
      const image = screenshot ? await flattenAnnotations(screenshot, marks) : null;
      if (image && image.length > 8e6) throw new Error("Das Bild ist zu gro\xDF. Bitte w\xE4hle einen kleineren Screenshot aus.");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2e4);
      let response;
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
            ...sendSteps && steps.length ? { steps } : {},
            ...appContext ? { app_context: appContext } : {},
            page_path: context2.route,
            screenshot_base64: image,
            annotation_data: { version: 1, marks },
            device_context: context2,
            app_version: appVersion,
            metadata: { capture_source: captureSource },
            session_id: sessionId,
            target_type: targetType,
            target_ref: targetRef
          })
        });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(response.status === 429 ? "Bitte warte kurz und versuche es dann erneut." : "Feedback konnte nicht gesendet werden. Dein Entwurf bleibt erhalten.");
      setNote("");
      setTranscriptOriginal("");
      setScreenshot(null);
      setMarks([]);
      setCaptureSource(null);
      setCategory(null);
      setSteps([]);
      setAppContext(void 0);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error && (cause.message.startsWith("Das Bild") || cause.message.startsWith("Bitte warte")) ? cause.message : "Feedback konnte nicht gesendet werden. Dein Entwurf bleibt erhalten.");
    } finally {
      setSaving(false);
    }
  }
  const press = "po:transition po:duration-150 po:active:scale-[0.96] po:focus-visible:outline-2 po:focus-visible:outline-offset-2 po:focus-visible:outline-violet-300";
  const chip = cn(press, "po:inline-flex po:min-h-12 po:items-center po:justify-center po:gap-2 po:whitespace-nowrap po:rounded-2xl po:bg-white/[0.06] po:px-3 po:text-sm po:text-zinc-200 po:ring-1 po:ring-white/10 po:hover:bg-white/10 po:disabled:opacity-40");
  const panel = open ? /* @__PURE__ */ jsx2(
    "div",
    {
      "data-pointout-root": true,
      "data-feedback-screenshot-ignore": true,
      "data-testid": "feedback-backdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) setOpen(false);
      },
      className: "po:fixed po:inset-0 po:z-[100] po:flex po:items-end po:justify-center po:bg-zinc-950/70 po:p-0 po:backdrop-blur-sm po:sm:items-center po:sm:p-6",
      children: /* @__PURE__ */ jsxs2(
        "div",
        {
          ref: dialogRef,
          "data-feedback-panel": true,
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Feedback geben",
          tabIndex: -1,
          onKeyDown: (event) => {
            if (event.key === "Enter" && event.shiftKey && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void saveNote();
            }
          },
          className: "po:relative po:flex po:h-[var(--pointout-height,100dvh)] po:w-full po:flex-col po:overflow-hidden po:rounded-t-[28px] po:bg-zinc-950 po:bg-[radial-gradient(120%_70%_at_0%_0%,rgba(139,92,246,0.22),transparent_55%),radial-gradient(90%_60%_at_100%_100%,rgba(236,72,153,0.12),transparent_60%)] po:shadow-[0_-12px_60px_rgba(0,0,0,0.6)] po:outline-none po:ring-1 po:ring-white/10 po:sm:h-auto po:sm:max-h-[92dvh] po:sm:max-w-2xl po:sm:rounded-[28px] po:sm:shadow-[0_30px_90px_rgba(0,0,0,0.6)]",
          children: [
            /* @__PURE__ */ jsx2("span", { "aria-hidden": "true", className: "po:mx-auto po:mt-2 po:block po:h-1.5 po:w-10 po:shrink-0 po:rounded-full po:bg-white/20 po:sm:hidden" }),
            saved ? /* @__PURE__ */ jsxs2("div", { "data-testid": "feedback-saved-state", className: "po:flex po:flex-1 po:flex-col po:items-center po:justify-center po:gap-3 po:px-6 po:py-10 po:text-center", children: [
              /* @__PURE__ */ jsx2("span", { className: "po:grid po:h-16 po:w-16 po:place-items-center po:rounded-full po:bg-emerald-400/15 po:ring-1 po:ring-emerald-300/30", children: /* @__PURE__ */ jsx2(CheckCircle2, { className: "po:h-9 po:w-9 po:text-emerald-300" }) }),
              /* @__PURE__ */ jsx2("p", { className: "po:text-lg po:font-semibold po:text-white", children: "Danke f\xFCr dein Feedback!" }),
              /* @__PURE__ */ jsx2("p", { className: "po:text-sm po:text-zinc-400", children: "Dein Hinweis ist angekommen." })
            ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
              /* @__PURE__ */ jsxs2("header", { className: "po:flex po:shrink-0 po:items-center po:justify-between po:gap-3 po:px-4 po:pt-2 po:pb-3 po:sm:px-6 po:sm:pt-5", children: [
                /* @__PURE__ */ jsxs2("div", { className: "po:min-w-0", children: [
                  /* @__PURE__ */ jsxs2("h3", { className: "po:flex po:items-center po:gap-2 po:text-lg po:font-semibold po:tracking-tight po:text-white", children: [
                    /* @__PURE__ */ jsx2("span", { "aria-hidden": "true", className: "po:h-2.5 po:w-2.5 po:rounded-full po:bg-gradient-to-br po:from-violet-400 po:to-fuchsia-500 po:shadow-[0_0_12px_rgba(192,132,252,0.8)]" }),
                    "Feedback"
                  ] }),
                  /* @__PURE__ */ jsx2("p", { className: "po:truncate po:text-xs po:text-zinc-400", children: resumedDraft ? "Ungesendeter Entwurf \xB7 Bild von vorher" : `${projectName} \xB7 Stelle markieren, dann beschreiben` })
                ] }),
                /* @__PURE__ */ jsx2("button", { type: "button", "aria-label": "Schlie\xDFen", onClick: () => setOpen(false), className: cn(press, "po:grid po:h-12 po:w-12 po:shrink-0 po:place-items-center po:rounded-full po:bg-white/[0.06] po:text-zinc-200 po:ring-1 po:ring-white/10 po:hover:bg-white/10"), children: /* @__PURE__ */ jsx2(X, { className: "po:h-5 po:w-5" }) })
              ] }),
              /* @__PURE__ */ jsxs2("div", { className: "po:min-h-0 po:flex-1 po:overflow-y-auto po:overscroll-contain po:px-3 po:pb-3 po:sm:px-6 po:sm:pb-4", children: [
                /* @__PURE__ */ jsxs2("div", { className: "po:relative", onContextMenu: (event) => {
                  event.preventDefault();
                  setPasteMenu(true);
                }, children: [
                  screenshot ? /* @__PURE__ */ jsx2(PointOutMarkup, { screenshot, marks, onChange: setMarks }) : capturing ? /* @__PURE__ */ jsx2("div", { role: "status", className: "po:grid po:min-h-56 po:animate-pulse po:place-items-center po:rounded-2xl po:bg-white/[0.04] po:p-5 po:text-center po:text-sm po:text-zinc-300 po:ring-1 po:ring-white/10", children: /* @__PURE__ */ jsxs2("span", { className: "po:inline-flex po:items-center po:gap-2", children: [
                    /* @__PURE__ */ jsx2(Loader2, { className: "po:h-4 po:w-4 po:animate-spin" }),
                    "Screenshot wird aufgenommen \u2026 du kannst schon schreiben oder einsprechen."
                  ] }) }) : /* @__PURE__ */ jsx2("div", { className: "po:grid po:min-h-48 po:place-items-center po:rounded-2xl po:border po:border-dashed po:border-white/15 po:bg-white/[0.03] po:p-5 po:text-center po:text-sm po:text-zinc-400", children: "Kein Screenshot vorhanden \u2013 w\xE4hle ein Bild aus oder beschreibe den Fehler direkt." }),
                  pasteMenu ? /* @__PURE__ */ jsx2(
                    "button",
                    {
                      type: "button",
                      onClick: () => {
                        setPasteMenu(false);
                        void pasteFromClipboard();
                      },
                      className: cn(press, "po:absolute po:right-2 po:top-2 po:z-10 po:min-h-12 po:rounded-2xl po:bg-zinc-800 po:px-4 po:text-sm po:text-white po:shadow-lg po:ring-1 po:ring-white/15"),
                      children: "Bild aus Zwischenablage einf\xFCgen"
                    }
                  ) : null
                ] }),
                captureError ? /* @__PURE__ */ jsx2("p", { role: "alert", className: "po:mt-2 po:rounded-xl po:bg-amber-400/10 po:px-3 po:py-2 po:text-sm po:text-amber-200", children: captureError }) : null,
                /* @__PURE__ */ jsxs2("div", { className: "po:mt-3 po:flex po:items-stretch po:gap-2", children: [
                  /* @__PURE__ */ jsx2("input", { ref: fileRef, type: "file", accept: "image/*", "aria-label": "Screenshot ausw\xE4hlen", className: "po:sr-only", onChange: (event) => void selectImage(event.target.files?.[0]) }),
                  /* @__PURE__ */ jsxs2("button", { type: "button", onClick: () => fileRef.current?.click(), className: cn(chip, "po:flex-1"), children: [
                    /* @__PURE__ */ jsx2(ImagePlus, { className: "po:h-4 po:w-4" }),
                    "Bild w\xE4hlen"
                  ] }),
                  /* @__PURE__ */ jsxs2("button", { type: "button", "aria-label": "Screenshot aus Zwischenablage einf\xFCgen", onClick: () => void pasteFromClipboard(), className: cn(chip, "po:flex-1"), children: [
                    /* @__PURE__ */ jsx2(ClipboardPaste, { className: "po:h-4 po:w-4" }),
                    "Einf\xFCgen"
                  ] }),
                  /* @__PURE__ */ jsxs2("button", { type: "button", "aria-label": "Aktuellen Bildschirm aufnehmen", disabled: capturing, onClick: () => void takeScreenshot(), className: cn(chip, "po:flex-1"), children: [
                    /* @__PURE__ */ jsx2(RotateCcw, { className: "po:h-4 po:w-4" }),
                    /* @__PURE__ */ jsx2("span", { className: "po:sm:hidden", children: "Neu" }),
                    /* @__PURE__ */ jsx2("span", { className: "po:hidden po:sm:inline", children: "Neu aufnehmen" })
                  ] }),
                  screenshot ? /* @__PURE__ */ jsx2("button", { type: "button", "aria-label": "Bild entfernen", title: "Bild entfernen", onClick: () => {
                    setScreenshot(null);
                    setMarks([]);
                    setCaptureSource(null);
                  }, className: cn(chip, "po:w-12 po:shrink-0 po:px-0 po:text-zinc-400"), children: /* @__PURE__ */ jsx2(X, { className: "po:h-4 po:w-4" }) }) : null
                ] }),
                steps.length ? /* @__PURE__ */ jsxs2("div", { className: "po:mt-3 po:rounded-2xl po:bg-white/[0.04] po:px-3 po:text-sm po:text-zinc-300 po:ring-1 po:ring-white/10", children: [
                  /* @__PURE__ */ jsxs2("div", { className: "po:flex po:items-center po:justify-between po:gap-2", children: [
                    /* @__PURE__ */ jsxs2("label", { className: "po:flex po:min-h-12 po:cursor-pointer po:items-center po:gap-3", children: [
                      /* @__PURE__ */ jsx2("input", { type: "checkbox", checked: sendSteps, onChange: (event) => setSendSteps(event.target.checked), className: "po:h-5 po:w-5 po:accent-violet-500" }),
                      "Letzte Schritte mitsenden (",
                      steps.length,
                      ")"
                    ] }),
                    /* @__PURE__ */ jsx2("button", { type: "button", "aria-expanded": showSteps, onClick: () => setShowSteps((current) => !current), className: cn(press, "po:min-h-11 po:shrink-0 po:rounded-xl po:px-3 po:text-xs po:text-zinc-400 po:hover:bg-white/10"), children: showSteps ? "Schritte ausblenden" : "Schritte ansehen" })
                  ] }),
                  showSteps ? /* @__PURE__ */ jsxs2("div", { className: "po:pb-2", children: [
                    /* @__PURE__ */ jsx2("ol", { className: "po:m-0 po:list-none po:space-y-0.5 po:p-0", children: steps.map((step, index) => /* @__PURE__ */ jsxs2("li", { className: "po:flex po:items-center po:justify-between po:gap-2", children: [
                      /* @__PURE__ */ jsx2("span", { className: cn("po:min-w-0 po:truncate po:font-mono po:text-[11px]", !sendSteps && "po:text-zinc-600 po:line-through"), children: stepLine(step) }),
                      /* @__PURE__ */ jsx2(
                        "button",
                        {
                          type: "button",
                          "aria-label": `Schritt entfernen: ${step.label}`,
                          onClick: () => setSteps((current) => current.filter((_, position) => position !== index)),
                          className: cn(press, "po:grid po:h-11 po:w-11 po:shrink-0 po:place-items-center po:rounded-xl po:text-zinc-500 po:hover:bg-white/10 po:hover:text-zinc-200"),
                          children: /* @__PURE__ */ jsx2(X, { className: "po:h-4 po:w-4" })
                        }
                      )
                    ] }, `${step.seconds_before}-${step.kind}-${step.label}-${index}`)) }),
                    /* @__PURE__ */ jsx2("p", { className: "po:mt-1 po:text-[11px] po:text-zinc-500", children: "Nur Klicks, Fehler und fehlgeschlagene Anfragen \u2013 nie deine Eingaben." })
                  ] }) : null
                ] }) : null
              ] }),
              /* @__PURE__ */ jsxs2("div", { "data-testid": "pointout-composer", className: "po:shrink-0 po:border-t po:border-white/10 po:bg-zinc-950/80 po:px-3 po:pt-3 po:pb-[max(0.75rem,env(safe-area-inset-bottom))] po:backdrop-blur po:sm:px-6 po:sm:pb-5", children: [
                /* @__PURE__ */ jsx2("div", { role: "group", "aria-label": "Art des Feedbacks (optional)", className: "po:mb-3 po:flex po:gap-2", children: CATEGORIES.map(({ value, label }) => /* @__PURE__ */ jsx2(
                  "button",
                  {
                    type: "button",
                    "aria-pressed": category === value,
                    onClick: () => setCategory((current) => current === value ? null : value),
                    className: cn(press, "po:min-h-11 po:flex-1 po:rounded-full po:px-4 po:text-sm po:font-medium po:ring-1 po:sm:flex-none", category === value ? "po:bg-violet-500 po:text-white po:ring-violet-300/60 po:shadow-[0_0_18px_rgba(139,92,246,0.45)]" : "po:bg-white/[0.05] po:text-zinc-300 po:ring-white/10 po:hover:bg-white/10"),
                    children: label
                  },
                  value
                )) }),
                /* @__PURE__ */ jsxs2("div", { className: "po:flex po:items-end po:gap-2", children: [
                  /* @__PURE__ */ jsx2(
                    "textarea",
                    {
                      value: note,
                      onChange: (event) => setNote(event.target.value),
                      placeholder: "Was ist passiert?",
                      rows: 2,
                      maxLength: 4e3,
                      "aria-label": "Feedback-Text",
                      className: "po:min-h-16 po:flex-1 po:resize-none po:rounded-2xl po:bg-white/[0.05] po:text-base po:text-zinc-100 po:outline-none po:placeholder:text-zinc-500 po:focus:border-violet-400/70"
                    }
                  ),
                  /* @__PURE__ */ jsxs2(
                    "button",
                    {
                      type: "button",
                      onClick: () => dictation.phase === "recording" ? dictation.stop() : void dictation.start(),
                      disabled: dictation.phase === "transcribing" || dictation.phase === "starting",
                      "aria-label": dictation.phase === "recording" ? "Aufnahme beenden" : dictation.phase === "transcribing" ? "Aufnahme wird umgewandelt" : dictation.phase === "starting" ? "Mikrofon wird vorbereitet" : "Einsprechen",
                      className: cn(
                        press,
                        "po:relative po:grid po:h-16 po:w-16 po:shrink-0 po:place-items-center po:rounded-2xl po:text-white po:shadow-lg po:disabled:opacity-60",
                        dictation.phase === "recording" ? "po:bg-rose-500 po:shadow-rose-900/50" : "po:bg-gradient-to-br po:from-violet-500 po:to-fuchsia-600 po:shadow-violet-900/50"
                      ),
                      children: [
                        dictation.phase === "recording" ? /* @__PURE__ */ jsx2("span", { "aria-hidden": "true", className: "po:absolute po:inset-0 po:animate-ping po:rounded-2xl po:bg-rose-400/40" }) : null,
                        dictation.phase === "recording" ? /* @__PURE__ */ jsx2(Square, { className: "po:relative po:h-6 po:w-6 po:fill-current" }) : dictation.phase === "transcribing" || dictation.phase === "starting" ? /* @__PURE__ */ jsx2(Loader2, { className: "po:h-6 po:w-6 po:animate-spin" }) : /* @__PURE__ */ jsx2(Mic, { className: "po:h-7 po:w-7" })
                      ]
                    }
                  )
                ] }),
                dictation.phase !== "idle" ? /* @__PURE__ */ jsx2("p", { role: "status", className: "po:mt-2 po:text-xs po:text-zinc-300", children: dictation.phase === "starting" ? "Mikrofon wird vorbereitet \u2026" : dictation.liveText ? /* @__PURE__ */ jsxs2(Fragment, { children: [
                  "\u201E",
                  dictation.liveText,
                  "\u201C",
                  dictation.phase === "recording" ? " \xB7 zum Beenden tippen" : " \u2026"
                ] }) : dictation.phase === "recording" ? "Aufnahme l\xE4uft \xB7 Mikrofon zum Beenden tippen" : "Sprache wird in Text umgewandelt \u2026" }) : null,
                dictation.error ? /* @__PURE__ */ jsx2("p", { role: "alert", className: "po:mt-2 po:text-sm po:text-amber-200", children: dictation.error }) : null,
                error ? /* @__PURE__ */ jsx2("p", { role: "alert", className: "po:mt-2 po:text-sm po:text-rose-300", children: error }) : null,
                /* @__PURE__ */ jsx2(
                  "button",
                  {
                    type: "button",
                    onClick: () => void saveNote(),
                    disabled: !note.trim() || saving || capturing || dictation.phase !== "idle",
                    className: cn(press, "po:mt-3 po:flex po:min-h-14 po:w-full po:items-center po:justify-center po:rounded-2xl po:bg-gradient-to-r po:from-violet-500 po:to-fuchsia-600 po:text-base po:font-semibold po:text-white po:shadow-[0_10px_30px_rgba(139,92,246,0.35)] po:hover:brightness-110 po:disabled:opacity-40 po:disabled:shadow-none"),
                    children: saving ? /* @__PURE__ */ jsxs2(Fragment, { children: [
                      /* @__PURE__ */ jsx2(Loader2, { className: "po:mr-2 po:h-4 po:w-4 po:animate-spin" }),
                      "Senden \u2026"
                    ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
                      "Feedback senden ",
                      /* @__PURE__ */ jsx2("kbd", { "aria-hidden": "true", className: "po:ml-3 po:hidden po:font-mono po:text-[10px] po:font-normal po:text-violet-100/80 po:sm:inline", children: "Strg + \u21E7 + Enter" })
                    ] })
                  }
                )
              ] })
            ] })
          ]
        }
      )
    }
  ) : null;
  const trigger = /* @__PURE__ */ jsxs2(
    "button",
    {
      "data-pointout-root": true,
      "aria-label": triggerVariant === "footer" ? "Feedback senden" : "Feedback geben",
      title: triggerVariant === "icon" ? "Feedback geben" : void 0,
      "data-feedback-screenshot-ignore": true,
      onClick: openDialog,
      disabled: capturing,
      "data-feedback-trigger": triggerVariant === "floating" || triggerVariant === "footer" ? "fixed" : void 0,
      className: cn(
        press,
        "po:inline-flex po:items-center",
        triggerVariant === "floating" ? "po:fixed po:right-4 po:bottom-[max(1rem,env(safe-area-inset-bottom))] po:z-[80] po:min-h-12 po:gap-2 po:rounded-full po:bg-zinc-900/85 po:px-5 po:text-sm po:font-medium po:text-zinc-50 po:shadow-[0_10px_30px_rgba(0,0,0,0.45)] po:ring-1 po:ring-white/15 po:backdrop-blur-md po:hover:bg-zinc-800 po:sm:right-5 po:sm:bottom-5" : triggerVariant === "icon" ? "po:relative po:z-10 po:h-11 po:w-11 po:justify-center po:rounded-xl po:text-zinc-400 po:ring-1 po:ring-white/10 po:hover:bg-white/10 po:hover:text-zinc-100" : triggerVariant === "footer" ? "po:fixed po:right-0 po:bottom-5 po:z-[80] po:min-h-11 po:gap-1.5 po:rounded-l-2xl po:bg-zinc-900/90 po:px-4 po:text-sm po:text-zinc-100 po:shadow-md po:ring-1 po:ring-violet-400/40 po:backdrop-blur po:sm:static po:sm:z-auto po:sm:min-h-0 po:sm:rounded-none po:sm:bg-transparent po:sm:px-0 po:sm:text-xs po:sm:text-zinc-500 po:sm:shadow-none po:sm:ring-0 po:sm:backdrop-blur-none po:sm:hover:text-zinc-200" : "po:relative po:z-10 po:min-h-11 po:gap-2 po:rounded-full po:bg-zinc-900/85 po:px-4 po:text-sm po:text-zinc-100 po:shadow-lg po:ring-1 po:ring-white/15 po:backdrop-blur po:hover:bg-zinc-800"
      ),
      children: [
        capturing ? /* @__PURE__ */ jsx2(Loader2, { className: "po:h-4 po:w-4 po:animate-spin" }) : triggerVariant === "floating" ? /* @__PURE__ */ jsx2("span", { "aria-hidden": "true", className: "po:relative po:grid po:h-6 po:w-6 po:place-items-center po:rounded-full po:bg-gradient-to-br po:from-violet-500 po:to-fuchsia-600", children: /* @__PURE__ */ jsx2(MessageSquarePlus, { className: "po:h-3.5 po:w-3.5 po:text-white" }) }) : /* @__PURE__ */ jsx2(MessageSquarePlus, { className: cn("po:h-4 po:w-4", triggerVariant === "footer" && "po:sm:h-3.5 po:sm:w-3.5") }),
        triggerVariant === "footer" ? /* @__PURE__ */ jsx2("span", { children: "Feedback" }) : triggerVariant !== "icon" ? "Feedback" : null
      ]
    }
  );
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    triggerVariant === "floating" ? mounted ? createPortal(trigger, document.body) : null : trigger,
    typeof document === "undefined" ? panel : createPortal(panel, document.body)
  ] });
}
export {
  PointOutWidget,
  collectDeviceContext,
  safePageUrl
};
