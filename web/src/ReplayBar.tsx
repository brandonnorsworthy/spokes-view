import { useEffect, useState, type ReactElement } from "react";
import { formatInstant, spokeId } from "./format";
import { Icon } from "./Icon";
import { CHANGES } from "./replay";
import { Sheet } from "./Sheet";
import { usePhone } from "./usePhone";
import { Segmented, Toggle } from "./ViewOptions";

export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

export interface ReplayBarProps {
  /** What is being replayed, e.g. "SPOKE-5 Spokes" or "the whole tree". */
  scope: string;
  /** Steps played so far (0 = before the first). */
  step: number;
  total: number;
  playing: boolean;
  speed: Speed;
  /** When the step just played happened (RFC 3339), and who did it. */
  at: string | null;
  agent: string | null;
  caption: string;
  firstAt: string | null;
  timeZone: string;
  truncated: boolean;
  onStep: (step: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: Speed) => void;
  /** Keep the full (blurred) glow at 4× and 16× too; it costs frames on slow machines. */
  fullGlow: boolean;
  onFullGlow: (on: boolean) => void;
  onExit: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  // The scrubber handles its own arrow keys.
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function ReplayBar(p: ReplayBarProps): ReactElement {
  const { step, total, playing, onStep, onPlay, onExit } = p;
  const phone = usePhone();
  const [moreOpen, setMoreOpen] = useState(false);

  // Space plays and pauses, arrows step, Home and End jump; Escape leaves replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The phone sheet is a modal and handles its own keys.
      if (moreOpen || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as Element | null)?.closest("[data-id]") && e.key === " ") return;
      if (e.key === " ") {
        e.preventDefault();
        onPlay(!playing);
      } else if (e.key === "ArrowRight") {
        onPlay(false);
        onStep(Math.min(total, step + 1));
      } else if (e.key === "ArrowLeft") {
        onPlay(false);
        onStep(Math.max(0, step - 1));
      } else if (e.key === "Home") {
        onPlay(false);
        onStep(0);
      } else if (e.key === "End") {
        onPlay(false);
        onStep(total);
      } else if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onExit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, total, playing, moreOpen, onStep, onPlay, onExit]);

  const when = p.at
    ? formatInstant(p.at, p.timeZone)
    : p.firstAt
      ? `before ${formatInstant(p.firstAt, p.timeZone)}`
      : "";
  if (phone) return <PhoneBar p={p} when={when} moreOpen={moreOpen} setMoreOpen={setMoreOpen} />;
  return (
    <section className="replay" aria-label="Replay">
      <div className="replay-row">
        <span className="replay-title">
          Replay · <strong>{p.scope}</strong>
        </span>
        <div className="replay-controls" role="group" aria-label="Playback">
          <button
            type="button"
            className="btn icon"
            title="Back to the start (Home)"
            aria-label="Back to the start"
            onClick={() => {
              onPlay(false);
              onStep(0);
            }}
            disabled={step === 0}
          >
            ⏮
          </button>
          <button
            type="button"
            className="btn icon"
            title="Step back (←)"
            aria-label="Step back"
            onClick={() => {
              onPlay(false);
              onStep(Math.max(0, step - 1));
            }}
            disabled={step === 0}
          >
            ◀
          </button>
          <button
            type="button"
            className="btn icon play"
            title={playing ? "Pause (Space)" : "Play (Space)"}
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (!playing && step >= total) onStep(0);
              onPlay(!playing);
            }}
            disabled={total === 0}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="btn icon"
            title="Step forward (→)"
            aria-label="Step forward"
            onClick={() => {
              onPlay(false);
              onStep(Math.min(total, step + 1));
            }}
            disabled={step >= total}
          >
            ▶❘
          </button>
          <button
            type="button"
            className="btn icon"
            title="Jump to now (End)"
            aria-label="Jump to now"
            onClick={() => {
              onPlay(false);
              onStep(total);
            }}
            disabled={step >= total}
          >
            ⏭
          </button>
          <label className="replay-speed">
            <span className="sr-only">Speed</span>
            <select
              value={p.speed}
              onChange={(e) => {
                const v = SPEEDS.find((s) => String(s) === e.target.value);
                if (v) p.onSpeed(v);
              }}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn" onClick={onExit} title="Back to the live tree (Esc)">
          Exit replay
        </button>
      </div>
      <input
        className="replay-scrub"
        type="range"
        min={0}
        max={total}
        step={1}
        value={step}
        aria-label="Position in the history"
        aria-valuetext={`step ${String(step)} of ${String(total)}${when ? `, ${when}` : ""}`}
        onChange={(e) => {
          onPlay(false);
          onStep(Number(e.target.value));
        }}
      />
      <div className="replay-caption" aria-live={playing ? "off" : "polite"}>
        <span className="replay-pos">
          {String(step)}/{String(total)}
        </span>
        <span className="replay-when">{when}</span>
        {p.agent && <span className="replay-agent">{p.agent}</span>}
        <span className="replay-what">{step === 0 ? "the start" : p.caption}</span>
      </div>
      <div className="replay-foot">
        <ul className="replay-key" aria-label="Glow colours">
          {CHANGES.map((c) => (
            <li key={c.change}>
              <span className={`key-dot c-${c.change}`} aria-hidden="true" />
              {c.label}
            </li>
          ))}
        </ul>
        <label
          className="replay-option"
          title="The blurred glow at 4× and 16× too. It can make playback choppy on slower machines."
        >
          <input
            type="checkbox"
            checked={p.fullGlow}
            onChange={(e) => p.onFullGlow(e.target.checked)}
          />
          Full glow at 4×/16×
        </label>
      </div>
      {p.truncated && (
        <div className="replay-note">
          This history is very large: only its first part was loaded, so the replay ends early.
        </div>
      )}
    </section>
  );
}

/**
 * The phone's bar: docked above the tab bar, with a scrubber and big touch targets. What
 * does not fit (jump to start or end, the speed as segments, the glow switch, the colour
 * key) is in a sheet behind the "more" button.
 */
function PhoneBar({
  p,
  when,
  moreOpen,
  setMoreOpen,
}: {
  p: ReplayBarProps;
  when: string;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}): ReactElement {
  const { step, total, playing, onStep, onPlay } = p;
  const what = step === 0 ? "the start" : p.caption;
  const line = [what, when, p.agent].filter((x): x is string => !!x).join(" · ");
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(p.speed) + 1) % SPEEDS.length] ?? SPEEDS[0];
  return (
    <>
      <section className="replay replay-phone" aria-label="Replay" data-covers-graph>
        <div className="rp-caption" aria-live={playing ? "off" : "polite"}>
          <span className="rp-what">{line}</span>
          <span className="rp-pos">
            {String(step)} / {String(total)}
          </span>
        </div>
        <input
          className="replay-scrub"
          type="range"
          min={0}
          max={total}
          step={1}
          value={step}
          aria-label="Position in the history"
          aria-valuetext={`step ${String(step)} of ${String(total)}${when ? `, ${when}` : ""}`}
          onChange={(e) => {
            onPlay(false);
            onStep(Number(e.target.value));
          }}
        />
        <div className="rp-row">
          <button
            type="button"
            className="rp-btn"
            aria-label="Step back"
            onClick={() => {
              onPlay(false);
              onStep(Math.max(0, step - 1));
            }}
            disabled={step === 0}
          >
            ◀
          </button>
          <button
            type="button"
            className="rp-btn rp-play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (!playing && step >= total) onStep(0);
              onPlay(!playing);
            }}
            disabled={total === 0}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="rp-btn"
            aria-label="Step forward"
            onClick={() => {
              onPlay(false);
              onStep(Math.min(total, step + 1));
            }}
            disabled={step >= total}
          >
            ▶❘
          </button>
          <button
            type="button"
            className="rp-btn rp-speed"
            aria-label={`Speed ${String(p.speed)}×, tap for ${String(nextSpeed)}×`}
            onClick={() => p.onSpeed(nextSpeed)}
          >
            {p.speed}×
          </button>
          <button
            type="button"
            className="rp-btn"
            aria-label="More replay options"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <Icon name="more" />
          </button>
          <button type="button" className="rp-btn" aria-label="Exit replay" onClick={p.onExit}>
            <Icon name="close" />
          </button>
        </div>
        {p.truncated && (
          <div className="replay-note">
            This history is very large: only its first part was loaded, so the replay ends early.
          </div>
        )}
      </section>
      {moreOpen && (
        <Sheet label="Replay options" onClose={() => setMoreOpen(false)} className="replay-sheet">
          <div className="rs-head">Replay · {p.scope}</div>
          <div className="rs-jump">
            <button
              type="button"
              className="btn"
              disabled={step === 0}
              onClick={() => {
                onPlay(false);
                onStep(0);
              }}
            >
              ⏮ Start
            </button>
            <button
              type="button"
              className="btn"
              disabled={step >= total}
              onClick={() => {
                onPlay(false);
                onStep(total);
              }}
            >
              End ⏭
            </button>
          </div>
          <Segmented
            label="Speed"
            value={String(p.speed)}
            options={SPEEDS.map((s) => [String(s), `${String(s)}×`] as const)}
            onChange={(v) => {
              const s = SPEEDS.find((x) => String(x) === v);
              if (s) p.onSpeed(s);
            }}
          />
          <Toggle
            label="Full glow at 4×/16×"
            checked={p.fullGlow}
            onChange={() => p.onFullGlow(!p.fullGlow)}
          />
          <ul className="replay-key" aria-label="Glow colours">
            {CHANGES.map((c) => (
              <li key={c.change}>
                <span className={`key-dot c-${c.change}`} aria-hidden="true" />
                {c.label}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}

/** "SPOKE-5 Spokes", or "the whole tree" for the root. */
export function scopeLabel(id: number, title: string | undefined, isRoot: boolean): string {
  return isRoot ? "the whole tree" : `${spokeId(id)} ${title ?? ""}`.trim();
}
