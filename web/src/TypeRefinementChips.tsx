import type { ReactElement } from "react";
import { TypeIcon } from "./TypeIcon";
import { REFINEMENT_LABEL, TYPE_LABEL, refinementOf, typeOf } from "./format";
import type { NodeType, Refinement, ViewNode } from "./types";

export function TypeChip({ type }: { type: NodeType }): ReactElement {
  return (
    <span className={`chip type-chip t-${type}`} title={`Type: ${TYPE_LABEL[type]}`}>
      <TypeIcon type={type} />
      {TYPE_LABEL[type]}
    </span>
  );
}

export function RefinementChip({ refinement }: { refinement: Refinement }): ReactElement {
  return (
    <span
      className={`chip refinement-chip st-${refinement}`}
      title={`Refinement: ${REFINEMENT_LABEL[refinement]}`}
    >
      {REFINEMENT_LABEL[refinement]}
    </span>
  );
}

/** The node's type and refinement as chips; nothing when neither is set. */
export function TypeRefinementChips({ node }: { node: ViewNode }): ReactElement | null {
  const type = typeOf(node);
  const refinement = refinementOf(node);
  if (type === null && refinement === null) return null;
  return (
    <>
      {type !== null && <TypeChip type={type} />}
      {refinement !== null && <RefinementChip refinement={refinement} />}
    </>
  );
}
