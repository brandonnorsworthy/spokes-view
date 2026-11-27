/** The heights a phone's details sheet rests at. */
export type Snap = "peek" | "half" | "full";

export const SNAPS: readonly Snap[] = ["peek", "half", "full"];

/** Pixel heights for each snap on a screen `vh` pixels tall (kept in step with the CSS). */
export function snapHeights(vh: number, barPx = 56, tabbarPx = 64): Record<Snap, number> {
  return {
    peek: 150,
    half: Math.round(vh * 0.55),
    full: Math.max(200, vh - barPx - tabbarPx - 8),
  };
}

/**
 * Where a drag that ended at height `h` settles: the nearest snap, or `close` when it was
 * pulled well below the peek height. A fast flick (`velocity` in px/ms, positive = down)
 * moves one snap in its direction even when it didn't travel far.
 */
export function settle(
  h: number,
  from: Snap,
  heights: Record<Snap, number>,
  velocity = 0,
): Snap | "close" {
  if (h < heights.peek * 0.6) return "close";
  const i = SNAPS.indexOf(from);
  if (velocity > 0.6) return i === 0 ? "close" : (SNAPS[i - 1] ?? from);
  if (velocity < -0.6) return SNAPS[Math.min(SNAPS.length - 1, i + 1)] ?? from;
  let best: Snap = "half";
  for (const s of SNAPS) if (Math.abs(heights[s] - h) < Math.abs(heights[best] - h)) best = s;
  return best;
}

/** A tap on the handle: half and peek open to full, full drops back to half. */
export function tapped(from: Snap): Snap {
  return from === "full" ? "half" : "full";
}
