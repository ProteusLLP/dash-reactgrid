/* An independent translation layer between ReactGrid's existing cell-event
 * contract and Glide's canvas grid. No React imports: test mapping, lock rules
 * and value preservation without a browser.
 */
import { calendarDateFromValue, parseDateEntry, parseTimeEntry } from "./keyboardEntry.js";

export const dataRowAt = (rows, row) => rows[row + 1] ?? null;

export const cellAt = (rows, col, row) =>
  dataRowAt(rows, row)?.cells?.[col] ?? null;

export const isDataCell = (rows, cols, col, row) =>
  Number.isInteger(col) && Number.isInteger(row) &&
  col >= 0 && col < cols.length && row >= 0 &&
  row < rows.length - 1 &&
  !String(rows[row + 1]?.rowId ?? "").startsWith("__drg_virtual_");

export const displayValue = (cell) => {
  if (!cell) return "";
  switch (cell.type) {
    case "checkbox": return cell.checked ? "TRUE" : "FALSE";
    case "dropdown": {
      const opt = (cell.values || []).find(x => x.value === cell.selectedValue);
      return opt ? String(opt.label) : String(cell.selectedValue ?? "");
    }
    case "number":
    case "customnumber":
    case "percent":
      return Number.isFinite(cell.value) ?
        (cell.format ? cell.format.format(cell.value) : String(cell.value)) : "";
    case "date":
      return cell.date instanceof Date && !Number.isNaN(cell.date.getTime())
        ? [cell.date.getFullYear(),String(cell.date.getMonth()+1).padStart(2,"0"),
           String(cell.date.getDate()).padStart(2,"0")].join("-") : "";
    case "time":
      return cell.time instanceof Date && !Number.isNaN(cell.time.getTime())
        ? String(cell.time.getHours()).padStart(2,"0") + ":" +
          String(cell.time.getMinutes()).padStart(2,"0") : "";
    default: return String(cell.text ?? "");
  }
};

const finiteValue = (raw) => {
  if (raw === "" || raw === null || raw === undefined) return NaN;
  const num = Number(String(raw).replaceAll(",",""));
  return Number.isFinite(num) ? num : NaN;
};

export const editCell = (original, incoming, locale = "en-GB") => {
  if (!original || original.nonEditable || original.isDisabled) return null;
  const raw = incoming?.data ?? "";
  const str = String(raw);
  switch (original.type) {
    case "checkbox":
      return {...original, checked: raw === true};
    case "number":
    case "customnumber": {
      const value = finiteValue(raw);
      return Number.isFinite(value) || str.trim() === "" ?
        {...original, value} : null;
    }
    case "percent": {
      let value = finiteValue(raw);
      if (str.trim().endsWith("%")) value = finiteValue(str.trim().slice(0,-1));
      // Keyboard entry follows the percentage editor convention:
      // typing 37 means 37%, whereas a pasted 0.37 is already fractional.
      if (Number.isFinite(value)) {
        if (str.trim().endsWith("%") || Math.abs(value) > 1) value /= 100;
      }
      return Number.isFinite(value) || str.trim() === "" ?
        {...original, value} : null;
    }
    case "dropdown": {
      const matched = (original.values || []).find(option =>
        String(option.value) === str || String(option.label) === str);
      return matched ? {...original,selectedValue:matched.value} : null;
    }
    case "date": {
      if (!str.trim()) return {...original,date:undefined};
      const parsed = parseDateEntry(str,locale);
      return parsed ? {...original,date:parsed} : null;
    }
    case "time": {
      if (!str.trim()) return {...original,time:undefined};
      const parsed = parseTimeEntry(str,original.time);
      return parsed ? {...original,time:parsed} : null;
    }
    default: return {...original,text:str};
  }
};

export const publicLocation = (rows, columns, col, row) => {
  if (!isDataCell(rows,columns,col,row)) return null;
  return {rowId: rows[row+1].rowId,columnId:columns[col].columnId};
};

export const nativeRange = (rows, columns, rectangle) => {
  if (!rectangle || !columns.length || rows.length < 2) return [];
  const start = Math.max(0, Math.min(rows.length-2, rectangle.y));
  const end = Math.max(start, Math.min(rows.length-2,
    rectangle.y+rectangle.height-1));
  const c0 = Math.max(0,Math.min(columns.length-1,rectangle.x));
  const c1 = Math.max(c0,Math.min(columns.length-1,rectangle.x+rectangle.width-1));
  const position=(row,col)=>({
    row:{idx:row+1,rowId:rows[row+1].rowId},
    column:{idx:col,columnId:columns[col].columnId},
  });
  return [{first:position(start,c0),last:position(end,c1)}];
};
