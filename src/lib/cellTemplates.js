import { ExcelTextCellTemplate, ExcelDateCellTemplate, ExcelTimeCellTemplate } from "./ExcelKeyboardCells";
import { CustomNumberCellTemplate } from "./CustomNumberCell";
import { PercentCellTemplate } from "./PercentCell";
import { PortalDropdownCellTemplate } from "./PortalDropdownCell";

/** Each rendered grid owns its editor instances. Mutating the typing mode of
 * one grid must not affect another grid's active editor.
 * The same templates are used in ordinary and server-virtualised renderers.
 */
export const createCellTemplates = (dropdownMenuPortal = false) => ({
  text: new ExcelTextCellTemplate(),
  date: new ExcelDateCellTemplate(),
  time: new ExcelTimeCellTemplate(),
  customnumber: new CustomNumberCellTemplate(),
  percent: new PercentCellTemplate(),
  ...(dropdownMenuPortal ? { dropdown: new PortalDropdownCellTemplate() } : {}),
});
