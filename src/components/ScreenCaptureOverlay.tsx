import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import type { CapturedScreen, Language } from "../types";

interface Props {
  screens: CapturedScreen[];
  lang: Language;
  onCapture: (mime: string, dataUrl: string) => void;
  onClose: () => void;
}

interface DragState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function cropToDataUrl(
  image: HTMLImageElement,
  rect: { x: number; y: number; width: number; height: number },
): string {
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Full-screen overlay for region capture. The backend captures the primary
 * monitor to a PNG data URL; here the user drags a rectangle (Snipping Tool
 * style) and the cropped region is sent back as a JPEG data URL.
 */
export function ScreenCaptureOverlay({ screens, lang, onCapture, onClose }: Props) {
  const [activeScreen, setActiveScreen] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selecting, setSelecting] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const screen = screens[activeScreen] ?? screens[0];

  const getPosition = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!imgRef.current) return;
    const { x, y } = getPosition(e);
    setSelecting(true);
    setDrag({ startX: x, startY: y, endX: x, endY: y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!selecting || !drag) return;
    const { x, y } = getPosition(e);
    setDrag((d) => (d ? { ...d, endX: x, endY: y } : d));
  };

  const handlePointerUp = () => {
    if (!drag) return;
    const { startX, startY, endX, endY } = drag;
    setSelecting(false);
    setDrag(null);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    const img = imgRef.current;
    if (width < 8 || height < 8 || !img) return;
    // The screenshot is displayed scaled-down; the crop coordinates are in
    // displayed CSS pixels and must be scaled to the image's natural size.
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width > 0 ? img.naturalWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? img.naturalHeight / rect.height : 1;
    const x = Math.min(startX, endX) * scaleX;
    const y = Math.min(startY, endY) * scaleY;
    const dataUrl = cropToDataUrl(img, {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width * scaleX),
      height: Math.round(height * scaleY),
    });
    if (dataUrl) onCapture("image/jpeg", dataUrl);
  };

  const rectStyle = drag
    ? {
        left: Math.min(drag.startX, drag.endX),
        top: Math.min(drag.startY, drag.endY),
        width: Math.abs(drag.endX - drag.startX),
        height: Math.abs(drag.endY - drag.startY),
      }
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-300">
              {screen ? screen.name : t(lang, "screenCapture")}
            </span>
            {screens.length > 1 && (
              <div className="flex items-center gap-1">
                {screens.map((s, index) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveScreen(index)}
                    className={`h-1.5 w-1.5 rounded-full transition ${
                      index === activeScreen ? "bg-violet-400" : "bg-zinc-600 hover:bg-zinc-500"
                    }`}
                    aria-label={`Monitor ${index + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          >
            Esc
          </button>
        </div>

        <div className="relative overflow-hidden rounded-xl">
          {screen && (
            <img
              ref={imgRef}
              src={screen.dataUrl}
              alt="Screen"
              draggable={false}
              className="max-h-[62vh] max-w-[80vw] select-none"
              style={{ cursor: "crosshair" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
          )}
          {rectStyle && (
            <div
              className="pointer-events-none absolute border-2 border-violet-400 bg-violet-400/20"
              style={rectStyle}
            />
          )}
        </div>

        <p className="text-[11px] text-zinc-500">
          {t(lang, "captureHint")}
        </p>
      </div>
    </div>
  );
}
