import type { ReactElement } from "react";

// Line icons on a 16x16 grid, drawn like TypeIcon so they sit with the type chips.
const PATHS = {
  tree: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 6V2M8 10v4M6 8H2M10 8h4M9.4 6.6 12 4M6.6 9.4 4 12" />
    </>
  ),
  board: (
    <>
      <rect x="1.5" y="2" width="3.5" height="12" rx="1" />
      <rect x="6.25" y="2" width="3.5" height="8" rx="1" />
      <rect x="11" y="2" width="3.5" height="10" rx="1" />
    </>
  ),
  backlog: <path d="M2 3h12M4.5 8H14M7 13h7" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </>
  ),
  options: <path d="M2 3.5h12M4.5 8h7M7 12.5h2" />,
  more: (
    <>
      <circle cx="3" cy="8" r="0.8" />
      <circle cx="8" cy="8" r="0.8" />
      <circle cx="13" cy="8" r="0.8" />
    </>
  ),
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" rx="2" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </>
  ),
  link: (
    <path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.7.7M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.7-.7" />
  ),
  expand: <path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" />,
  collapse: <path d="M8 2v4M8 10v4M5 3l3 3 3-3M5 13l3-3 3 3M2 8h12" />,
  details: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <path d="M5 6h6M5 9h6M5 12h3" />
    </>
  ),
  focus: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

/** A small line icon, coloured by the surrounding text. */
export function Icon({ name, size = "1.15em" }: { name: IconName; size?: string }): ReactElement {
  return (
    <svg
      className={`icon icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
