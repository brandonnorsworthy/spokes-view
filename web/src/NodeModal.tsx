import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { NodeDetails, type DetailState } from "./DetailPanel";
import type { ViewNode } from "./types";

interface Props {
  detail: DetailState;
  fromTree: ViewNode | undefined;
  timeZone: string;
  today: string;
  onClose: () => void;
  onSelect: (id: number) => void;
  actions?: (n: ViewNode) => ReactNode;
}

/**
 * A node's details in a modal dialog. The native `<dialog>` gives focus trapping and
 * Escape for free; a click on the backdrop (the dialog element itself) closes it too.
 */
export function NodeModal(props: Props): ReactElement {
  const { onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label="Node details"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-body details">
        <NodeDetails {...props} />
      </div>
    </dialog>
  );
}
