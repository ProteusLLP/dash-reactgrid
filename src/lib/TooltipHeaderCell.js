import React from "react";
import { HeaderCellTemplate } from "@silevis/reactgrid";

/** Add an optional native browser tooltip without changing header behaviour.
 * The built-in header template still handles compatibility, styling and
 * column selection/resizing. Used for ordinary and server-backed grids.
 */
export class TooltipHeaderCellTemplate extends HeaderCellTemplate {
  render(cell, isInEditMode, onCellChanged) {
    const label = super.render(cell, isInEditMode, onCellChanged);
    if (typeof cell.tooltip !== "string" || !cell.tooltip) return label;
    return React.createElement("span", {
      className: "drg-header-tooltip",
      title: cell.tooltip,
    }, label);
  }
}
