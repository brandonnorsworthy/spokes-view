import { describe, expect, it } from "vitest";
import { settle, snapHeights, tapped } from "./sheetSnap";

const h = snapHeights(844);

describe("snapHeights", () => {
  it("peeks, sits at half the screen, and opens to just below the header", () => {
    expect(h).toEqual({ peek: 150, half: 464, full: 716 });
  });
});

describe("settle", () => {
  it("goes to the nearest snap", () => {
    expect(settle(700, "half", h)).toBe("full");
    expect(settle(480, "full", h)).toBe("half");
    expect(settle(170, "half", h)).toBe("peek");
  });

  it("closes when pulled well below the peek", () => {
    expect(settle(60, "peek", h)).toBe("close");
  });

  it("moves one snap with a flick, whatever the distance", () => {
    expect(settle(450, "half", h, 1.2)).toBe("peek");
    expect(settle(150, "peek", h, 1.2)).toBe("close");
    expect(settle(470, "half", h, -1.2)).toBe("full");
    expect(settle(716, "full", h, -1.2)).toBe("full");
  });
});

describe("tapped", () => {
  it("opens to full, and drops back to half from full", () => {
    expect(tapped("half")).toBe("full");
    expect(tapped("peek")).toBe("full");
    expect(tapped("full")).toBe("half");
  });
});
