import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

interface Props {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A modal bottom sheet. It is a real modal `<dialog>`, so it opens in the browser's top
 * layer, above anything else open, including the board's details dialog (a plain fixed
 * layer would sit behind that). The dialog traps focus and makes the page behind inert;
 * Escape, the backdrop or the caller's own button close it, and focus goes back to
 * whatever had it.
 */
export function Sheet({ label, onClose, children, className }: Props): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // A touch opened it: hold focus on the dialog itself, so no item shows a focus ring.
    // From a keyboard, start on the first item.
    if (window.matchMedia("(pointer: coarse)").matches) d?.focus();
    else d?.querySelector<HTMLElement>("button, a[href]")?.focus();
    return () => {
      before?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet-layer"
      aria-label={label}
      tabIndex={-1}
      onCancel={(e) => {
        // Escape: close this sheet only, not the dialog or panel behind it.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className={`sheet ${className ?? ""}`}>
        <div className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </dialog>
  );
}
