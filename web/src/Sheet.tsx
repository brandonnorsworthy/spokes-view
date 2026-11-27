import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

interface Props {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A modal bottom sheet: slides up over a dimmed page, closes on the backdrop, Escape or
 * the caller's own button, keeps Tab inside, and gives focus back to whatever had it.
 */
export function Sheet({ label, onClose, children, className }: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("button, a[href], input, select, [tabindex]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close the sheet only, not the panel behind it.
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && el) {
        const items = [
          ...el.querySelectorAll<HTMLElement>("button, a[href], input, select, [tabindex]"),
        ].filter((x) => !x.hasAttribute("disabled"));
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus();
    };
  }, [onClose]);

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={`sheet ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
