import React from 'react';
// NOTE: all modules imported below may be imported from '@silevis/reactgrid'

import { getCellProperty,keyCodes,  } from "@silevis/reactgrid";
import { isNumpadNumericKey, inNumericKey, isAllowedOnNumberTypingKey, isNavigationKey } from "@silevis/reactgrid";
import {NumberParser} from './NumberParser.js'

export const numberParser = new NumberParser(window.navigator.language)

export class CustomNumberCellTemplate {
    constructor() {
      }

    wasEscKeyPressed = false;

    getCompatibleCell(uncertainCell) {
        let value;
        try {
            value = getCellProperty(uncertainCell, 'value', 'number');
        } catch (error) {
            value = NaN;
        }
        const numberFormat = uncertainCell.format || new Intl.NumberFormat(window.navigator.language);
        const displayValue = (uncertainCell.nanToZero && Number.isNaN(value)) ? 0 : value;
        const text = (Number.isNaN(displayValue) || (uncertainCell.hideZero && displayValue === 0)) ? '' : numberFormat.format(displayValue);
        return { ...uncertainCell, value: displayValue, text }
    }

    handleKeyDown(cell, keyCode, ctrl,shift, alt){
        if (isNumpadNumericKey(keyCode)) keyCode -= 48;
        const char = String.fromCharCode(keyCode);
        if (!ctrl && !alt && !shift && (inNumericKey(keyCode) || isAllowedOnNumberTypingKey(keyCode)) ) {
            
            const value = Number(char);

            if (Number.isNaN(value) )
                return { cell: { ...this.getCompatibleCell({ ...cell, value }), text: char }, enableEditMode: true }
            return { cell: this.getCompatibleCell({ ...cell, value }), enableEditMode: true }
        }
        return { cell, enableEditMode: keyCode === keyCodes.POINTER || keyCode === keyCodes.ENTER }
    }

    update(cell, cellToMerge){
        return this.getCompatibleCell({ ...cell, value: cellToMerge.value });
    }

     getTextFromCharCode = (cellText)=> {
        switch (cellText.charCodeAt(0)) {
            case keyCodes.DASH:
            case keyCodes.FIREFOX_DASH:
            case keyCodes.SUBTRACT:
                return '-';
            case keyCodes.COMMA:
                return ','
            case keyCodes.PERIOD:
            case keyCodes.DECIMAL:
                return '.';
            default:
                return cellText;
        }
    }

    getClassName(cell, isInEditMode) {
        const isValid = cell.validator?.(cell.value) ?? true;
        const className = cell.className || '';
        return `${!isValid ? 'rg-invalid' : ''} ${className}`;
    }

    render(cell, isInEditMode, onCellChanged) {
        if (!isInEditMode) {
            const isValid = cell.validator?.(cell.value) ?? true;           
            const textToDisplay = !isValid && cell.errorMessage ? cell.errorMessage : cell.text;
            return textToDisplay;
        }

        const handleOnChange = (e)=>{
                    onCellChanged(this.getCompatibleCell({ ...cell, value: numberParser.parse(e.currentTarget.value)}), false)
            }

        const handleOnBlur = (e) => { 
            onCellChanged(this.getCompatibleCell({ ...cell, value: numberParser.parse(e.currentTarget.value) }), !this.wasEscKeyPressed); this.wasEscKeyPressed = false; }
        
        const locale = cell.format ? cell.format.resolvedOptions().locale : window.navigator.languages[0];
        const format = new Intl.NumberFormat(locale, {useGrouping: false, maximumFractionDigits: 17 });
        var defaultValue = Number.isNaN(cell.value) ? this.getTextFromCharCode(cell.text) : format.format(cell.value);
        return <input
            inputMode='text'
            className='rg-input'
            ref={input => {
                this.input = input
                if (input) {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            }}
            defaultValue={defaultValue}
            onChange={handleOnChange}
            onBlur={handleOnBlur}
            onKeyDown={(e) => {
                if (
                  inNumericKey(e.keyCode) ||
                  ((this.input.selectionStart!=this.input.value.length || this.input.selectionEnd!=this.input.value.length) && isNavigationKey(e.keyCode)) ||
                  isAllowedOnNumberTypingKey(e.keyCode) ||
                  ((e.ctrlKey || e.metaKey) && e.keyCode === keyCodes.KEY_A)
                )                   
                  e.stopPropagation();
                if (!inNumericKey(e.keyCode) && !((this.input.selectionStart!=this.input.value.length || this.input.selectionEnd!=this.input.value.length) && isNavigationKey(e.keyCode))  && !isAllowedOnNumberTypingKey(e.keyCode)) e.preventDefault();
                if (e.keyCode === keyCodes.ESCAPE) this.wasEscKeyPressed = true;
            }}
            onCopy={e => e.stopPropagation()}
            onCut={e => e.stopPropagation()}
            onPaste={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
        />
    }
}
