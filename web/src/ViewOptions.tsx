import type { ReactElement, ReactNode } from "react";

/**
 * Building blocks for a page's view options. On a phone they make up the options sheet from
 * the approved mockup: labelled sections, a grouped list of switches, a segmented control
 * and grids of small buttons. On a wide screen the groups dissolve and every control sits
 * in the top bar in a row, as before.
 */

/** A labelled section: `list` groups switches in one rounded box, `grid` lays buttons out. */
export function OptGroup({
  label,
  layout = "stack",
  children,
}: {
  label?: string;
  layout?: "stack" | "list" | "grid2" | "grid3";
  children: ReactNode;
}): ReactElement {
  return (
    <div className={`opt-group opt-${layout}`} role="group" aria-label={label}>
      {label && (
        <span className="opt-label" aria-hidden="true">
          {label}
        </span>
      )}
      <div className="opt-body">{children}</div>
    </div>
  );
}

/** An on/off switch (a real checkbox underneath, so keyboard and screen readers work). */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}): ReactElement {
  return (
    <label className="opt-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

/** One choice out of a few, as a row of segments. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}): ReactElement {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={v === value ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The server picker: a native select (best on phones) dressed as a row with a status dot. */
export function ServerPicker({
  servers,
  value,
  onChange,
}: {
  servers: { name: string; status: string; version: string | null }[] | null;
  value: string | null;
  onChange: (name: string) => void;
}): ReactElement {
  const current = servers?.find((s) => s.name === value);
  return (
    <label className="server-row">
      <span className="sr-only">Server</span>
      <span
        className={`server-dot ${current?.status === "ok" ? "ok" : current ? "bad" : ""}`}
        aria-hidden="true"
      />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={!servers || servers.length === 0}
      >
        {(servers ?? []).map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
            {s.status === "ok"
              ? s.version
                ? ` (${s.version})`
                : ""
              : ` (${s.status.replace("_", " ")})`}
          </option>
        ))}
      </select>
    </label>
  );
}
