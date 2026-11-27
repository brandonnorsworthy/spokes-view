import { useCallback, useRef, useState, type PointerEvent } from "react";
import { settle, snapHeights, tapped, type Snap } from "./sheetSnap";

export interface SheetGrip {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

/**
 * Drag a phone's details sheet between half and full by its top (the handle and the
 * header): the sheet follows the finger, then settles on the nearest height, a flick moves
 * one step, swiping down from half closes it in one go, and a tap on the handle opens it to
 * full (or back to half). Off (`enabled` false) on wide screens, where it is a side panel.
 */
export function useSheetSnap(
  enabled: boolean,
  onClose: () => void,
): {
  /** Callback ref for the sheet element. */
  attach: (el: HTMLElement | null) => void;
  snap: Snap;
  setSnap: (s: Snap) => void;
  grip: SheetGrip;
  toggle: () => void;
} {
  const ref = useRef<HTMLElement | null>(null);
  const [snap, setSnap] = useState<Snap>("half");
  const drag = useRef<{ y: number; h: number; t: number; lastY: number; lastT: number } | null>(
    null,
  );

  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean): void => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = "";
    el.style.height = "";
    if (cancelled) return;
    const dy = e.clientY - d.y;
    // A tap: only the handle reacts (the header has links and buttons of its own).
    if (Math.abs(dy) < 6) {
      if ((e.target as Element).closest(".sheet-handle")) setSnap(tapped(snap));
      return;
    }
    const dt = Math.max(1, e.timeStamp - d.lastT);
    const velocity = (e.clientY - d.lastY) / dt;
    const next = settle(d.h - dy, snap, snapHeights(window.innerHeight), velocity);
    if (next === "close") onClose();
    else setSnap(next);
  };

  const grip: SheetGrip = {
    onPointerDown: (e) => {
      if (!enabled || e.button !== 0) return;
      // Buttons and links in the header keep working as taps.
      if ((e.target as Element).closest("button:not(.sheet-handle), a")) return;
      const el = ref.current;
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      drag.current = { y: e.clientY, h, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp };
      el.style.transition = "none";
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      const el = ref.current;
      if (!d || !el) return;
      const max = snapHeights(window.innerHeight).full;
      el.style.height = `${Math.min(max, Math.max(60, d.h - (e.clientY - d.y)))}px`;
      // Velocity is measured over the last stretch of the drag, not the whole of it.
      if (e.timeStamp - d.lastT > 60) {
        d.lastY = e.clientY;
        d.lastT = e.timeStamp;
      }
    },
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
  };

  const attach = useCallback((el: HTMLElement | null) => {
    ref.current = el;
  }, []);

  return { attach, snap, setSnap, grip, toggle: () => setSnap(tapped(snap)) };
}
