import React from "react";
import { TextCellTemplate, DateCellTemplate, TimeCellTemplate } from "@silevis/reactgrid";
import { isPlainArrow, isTypingKey, parseDateEntry, parseTimeEntry } from "./keyboardEntry";

/** Direct typing edits the cell, and arrows commit/move as in Excel.
 * Double click/Enter retain native caret navigation for in-cell editing.
 */
export class ExcelTextCellTemplate extends TextCellTemplate {
  directTyping = false;

  handleKeyDown(cell, keyCode, ctrl, shift, alt, key) {
    if (isTypingKey(key, ctrl, alt)) {
      this.directTyping = true;
      return { cell: this.getCompatibleCell({ ...cell, text: key }), enableEditMode: true };
    }
    const result = super.handleKeyDown(cell, keyCode, ctrl, shift, alt, key);
    if (result.enableEditMode) this.directTyping = false;
    return result;
  }

  render(cell, isInEditMode, onCellChanged) {
    const content = super.render(cell, isInEditMode, onCellChanged);
    if (!isInEditMode || !React.isValidElement(content)) return content;
    const original = content.props.onKeyDown;
    return React.cloneElement(content, {
      onKeyDown: (event) => {
        if (this.directTyping && (isPlainArrow(event) || event.key === "Enter" || event.key === "Tab")) {
          onCellChanged(this.getCompatibleCell({ ...cell, text: event.currentTarget.value }), false);
          return;
        }
        original?.(event);
      },
    });
  }
}

/** Native date/time inputs are retained for mouse/Enter editing.
 * When entry begins with typing, use a text editor so the whole ISO or
 * local-format value can be entered as a sequence instead of fragmented
 * among browser-specific date/time input segments.
 */
const entryInput = (template, cell, convert, onCellChanged) => {
  const changed = (text, commit) => {
    const date = convert(text);
    const next = date ? template.getCompatibleCell({
      ...cell, [cell.type === "date" ? "date" : "time"]: date,
    }) : cell;
    onCellChanged(next, commit);
  };
  return (
    <input
      className="rg-input"
      type="text"
      autoComplete="off"
      ref={(element) => {
        if (element && document.activeElement !== element) element.focus();
      }}
      defaultValue={template.initialKey}
      onChange={(event) => changed(event.currentTarget.value, false)}
      onBlur={(event) => {
        if (!template.cancelEntry) changed(event.currentTarget.value, true);
        template.cancelEntry = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          template.cancelEntry = true;
          return;
        }
        if (isPlainArrow(event) || event.key === "Tab" || event.key === "Enter") {
          changed(event.currentTarget.value, false);
          return;
        }
        event.stopPropagation();
      }}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
};

export class ExcelDateCellTemplate extends DateCellTemplate {
  directTyping = false;
  initialKey = "";
  cancelEntry = false;

  handleKeyDown(cell, keyCode, ctrl, shift, alt, key) {
    const result = super.handleKeyDown(cell, keyCode, ctrl, shift, alt, key);
    if (result.enableEditMode) {
      this.directTyping = isTypingKey(key, ctrl, alt) && /[0-9]/.test(key);
      this.initialKey = this.directTyping ? key : "";
      this.cancelEntry = false;
    }
    return result;
  }

  render(cell, isInEditMode, onCellChanged) {
    if (!isInEditMode || !this.directTyping)
      return super.render(cell, isInEditMode, onCellChanged);
    return entryInput(this, cell,
      (value) => parseDateEntry(value, window.navigator.language), onCellChanged);
  }
}

export class ExcelTimeCellTemplate extends TimeCellTemplate {
  directTyping = false;
  initialKey = "";
  cancelEntry = false;

  handleKeyDown(cell, keyCode, ctrl, shift, alt, key) {
    const result = super.handleKeyDown(cell, keyCode, ctrl, shift, alt, key);
    if (result.enableEditMode) {
      this.directTyping = isTypingKey(key, ctrl, alt) && /[0-9]/.test(key);
      this.initialKey = this.directTyping ? key : "";
      this.cancelEntry = false;
    }
    return result;
  }

  render(cell, isInEditMode, onCellChanged) {
    if (!isInEditMode || !this.directTyping)
      return super.render(cell, isInEditMode, onCellChanged);
    return entryInput(this, cell,
      (value) => parseTimeEntry(value, cell.time), onCellChanged);
  }
}
