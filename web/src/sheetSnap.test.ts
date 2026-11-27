import { describe, expect, it } from "vitest";
import { settle, snapHeights, tapped } from "./sheetSnap";

const h = snapHeights(844);

describe("snapHeights", () => {
  it("sits at half the screen and opens to just below the header", () => {
    expect(h).toEqual({ half: 464, full: 716 });
  });
});

describe("settle", () => {
  it("goes to the nearer of half and full", () => {
    expect(settle(700, "half", h)).toBe("full");
    expect(settle(480, "full", h)).toBe("half");
  });

  it("closes in one swipe when pulled clearly below half (no peek step)", () => {
    expect(settle(300, "half", h)).toBe("close");
    expect(settle(60, "half", h)).toBe("close");
  });

  it("moves one step with a flick: full to half, half to closed, half to full", () => {
    expect(settle(700, "full", h, 1.2)).toBe("half");
    expect(settle(450, "half", h, 1.2)).toBe("close");
    expect(settle(470, "half", h, -1.2)).toBe("full");
    expect(settle(716, "full", h, -1.2)).toBe("full");
  });
});

describe("tapped", () => {
  it("opens to full, and drops back to half from full", () => {
    expect(tapped("half")).toBe("full");
    expect(tapped("full")).toBe("half");
  });
});
