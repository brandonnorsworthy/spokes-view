import { describe, expect, it } from "vitest";
import { linkActions } from "./NodeActions";

const labels = (xs: { label: string }[]) => xs.map((x) => x.label);
const hrefOf = (xs: ReturnType<typeof linkActions>, label: string) => {
  const a = xs.find((x) => x.label === label);
  return a && "href" in a ? a.href : undefined;
};

describe("linkActions", () => {
  it("offers board and backlog only for a node with children", () => {
    expect(labels(linkActions("Home", { id: 96, child_count: 3 }))).toEqual([
      "View board",
      "View backlog",
      "Show in tree",
      "Copy ID",
      "Copy link",
    ]);
    expect(labels(linkActions("Home", { id: 173, child_count: 0 }))).toEqual([
      "Show in tree",
      "Copy ID",
      "Copy link",
    ]);
  });

  it("leaves out Show in tree on the tree itself", () => {
    expect(labels(linkActions("Home", { id: 96, child_count: 3 }, { tree: false }))).not.toContain(
      "Show in tree",
    );
  });

  it("links to the board, backlog and tree of that node on that server", () => {
    const xs = linkActions("My Home", { id: 96, child_count: 3 });
    expect(hrefOf(xs, "View board")).toBe("/?server=My+Home&kanban=96");
    expect(hrefOf(xs, "View backlog")).toBe("/?server=My+Home&backlog=96");
    expect(hrefOf(xs, "Show in tree")).toBe("/?server=My+Home&node=96");
  });

  it("never offers anything that changes the tree", () => {
    const xs = linkActions("Home", { id: 96, child_count: 3 });
    for (const x of xs) expect(x.label).toMatch(/^(View|Show|Copy) /);
  });
});
