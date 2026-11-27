/**
 * Scroll a card or row into view and make it glow for a moment, once it is drawn (a pick
 * may first switch the column, unfold a branch or page in more cards).
 */
export function revealNode(id: number): void {
  let tries = 0;
  const step = (): void => {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) {
      if (++tries < 20) requestAnimationFrame(step);
      return;
    }
    el.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
    el.classList.remove("found");
    // Restart the glow even when the same node is picked twice in a row (next frame).
    requestAnimationFrame(() => el.classList.add("found"));
    window.setTimeout(() => el.classList.remove("found"), 1800);
  };
  requestAnimationFrame(step);
}
