/**
 * The heights a phone's details sheet rests at. There is no in-between "peek": a swipe down
 * from half closes the sheet in one go (Brandon's phone check, 2026-11-27).
 */
export type Snap = "half" | "full";

export const SNAPS: readonly Snap[] = ["half", "full"];

/** Pixel heights for each snap on a screen `vh` pixels tall (kept in step with the CSS). */
export function snapHeights(vh: number, barPx = 56, tabbarPx = 64): Record<Snap, number> {
  return {
    half: Math.round(vh * 0.55),
    full: Math.max(200, vh - barPx - tabbarPx - 8),
  };
}

/**
 * Where a drag that ended at height `h` settles. Pulled clearly below half, it closes;
 * otherwise it goes to the nearer of half and full. A fast flick (`velocity` in px/ms,
 * positive = down) moves one step in its direction: full to half, half to closed, half to
 * full.
 */
export function settle(
  h: number,
  from: Snap,
  heights: Record<Snap, number>,
  velocity = 0,
): Snap | "close" {
  if (velocity > 0.5) return from === "full" ? "half" : "close";
  if (velocity < -0.5) return "full";
  if (h < heights.half * 0.75) return "close";
  return Math.abs(heights.full - h) < Math.abs(heights.half - h) ? "full" : "half";
}

/** A tap on the handle: half opens to full, full drops back to half. */
export function tapped(from: Snap): Snap {
  return from === "full" ? "half" : "full";
}
