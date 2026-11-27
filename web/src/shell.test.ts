/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("phone app bar", () => {
  it("drops the header blur on phones, so its fixed sheet and search bar stay on screen", () => {
    // A backdrop-filter (or filter/transform) on .appbar would pin the fixed view-options
    // sheet to the 56px header: on a real phone it opened off the top of the screen.
    const phone = [...css.matchAll(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/g)].map(
      (m) => m[1] ?? "",
    );
    const rule = phone
      .map((block) => /\.appbar \{([^}]*)\}/.exec(block)?.[1] ?? "")
      .filter((body) => body.includes("backdrop-filter"))
      .pop();
    expect(rule).toMatch(/(^|[^-])backdrop-filter: none/);
  });

  it("drops the blur on the phone's open search bar, so its result list fills the screen", () => {
    const phone = [...css.matchAll(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/g)].map(
      (m) => m[1] ?? "",
    );
    const rule = phone
      .map((block) => /\.appbar-search\.open \{([^}]*)\}/.exec(block)?.[1] ?? "")
      .filter((body) => body.includes("backdrop-filter"))
      .pop();
    expect(rule).toMatch(/(^|[^-])backdrop-filter: none/);
  });
});
