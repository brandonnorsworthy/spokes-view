import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { NodeDetails, type DetailState } from "./DetailPanel";
import { usePhone } from "./usePhone";
import { useSheetSnap } from "./useSheetSnap";
import type { ViewNode } from "./types";

interface Props {
  detail: DetailState;
  fromTree: ViewNode | undefined;
  timeZone: string;
  today: string;
  onClose: () => void;
  onSelect: (id: number) => void;
  actions?: (n: ViewNode) => ReactNode;
  onActions?: (n: ViewNode, x: number, y: number) => void;
}

/**
 * A node's details in a modal dialog. The native `<dialog>` gives focus trapping and
 * Escape for free; a click on the backdrop (the dialog element itself) closes it too.
 */
export function NodeModal(props: Props): ReactElement {
  const { onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  // On a phone the dialog is a bottom sheet you can drag between peek, half and full.
  const phone = usePhone();
  const sheet = useSheetSnap(phone, onClose);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={(el) => {
        ref.current = el;
        sheet.attach(el);
      }}
      className="modal"
      data-snap={phone ? sheet.snap : undefined}
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
        <NodeDetails {...props} grip={phone ? sheet.grip : undefined} onHandle={sheet.toggle} />
      </div>
    </dialog>
  );
}
