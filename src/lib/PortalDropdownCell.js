import React, { useEffect, useMemo, useRef, useState } from 'react';
import Select, { components } from 'react-select';
import { DropdownCellTemplate } from '@silevis/reactgrid';
import { menuPortalProps, menuPortalStyle } from './portal';

/**
 * ReactGrid's dropdown cell, with its menu rendered in a portal on the page body.
 *
 * Everything but where the menu renders is ReactGrid's: the cell's state,
 * keyboard handling and updates come from DropdownCellTemplate, and the
 * control below mirrors ReactGrid's own, so a portalled dropdown behaves like
 * any other. ReactGrid bundles its own react-select and gives it no way to
 * portal the menu, which is why this renders one of its own.
 */
export class PortalDropdownCellTemplate extends DropdownCellTemplate {
  render(cell, isInEditMode, onCellChanged) {
    return (
      <PortalDropdown
        cell={cell}
        onCellChanged={(changed) => onCellChanged(this.getCompatibleCell(changed), true)}
      />
    );
  }
}

// The menu and its options sit outside the grid once portalled. Stopping the
// pointer down keeps it from reaching the cell (which would reopen the menu)
// and the grid (which would move the selection), as ReactGrid's menu does.
const stopPointerDown = (event) => event.stopPropagation();

const Menu = (props) => (
  <components.Menu
    {...props}
    className="rg-dropdown-menu"
    innerProps={{ ...props.innerProps, onPointerDown: stopPointerDown }}
  />
);

const Option = ({ innerProps, innerRef, label, isSelected, isFocused, isDisabled }) => (
  <div
    {...innerProps}
    ref={innerRef}
    onPointerDown={stopPointerDown}
    className={
      'rg-dropdown-option' +
      (isSelected ? ' selected' : '') +
      (isFocused ? ' focused' : '') +
      (isDisabled ? ' disabled' : '')
    }
  >
    {label}
  </div>
);

const PortalDropdown = ({ cell, onCellChanged }) => {
  const selectRef = useRef(null);
  const [inputValue, setInputValue] = useState(cell.inputValue);
  const selected = useMemo(
    () => cell.values.find((option) => option.value === cell.text),
    [cell.text, cell.values]
  );

  useEffect(() => {
    if (cell.isOpen && selectRef.current) {
      selectRef.current.focus();
      setInputValue(cell.inputValue);
    }
  }, [cell.isOpen, cell.inputValue]);

  // ReactGrid's control styles, with the cell's own overrides on top.
  const own = cell.styles || {};
  const merge = (part, style) => (base) => ({ ...base, ...style, ...(own[part] || {}) });

  return (
    <div style={{ width: '100%' }} onPointerDown={() => onCellChanged({ ...cell, isOpen: true })}>
      <Select
        {...(cell.inputValue && {
          inputValue,
          defaultInputValue: inputValue,
          onInputChange: (value) => setInputValue(value),
        })}
        {...(cell.isOpen !== undefined && { menuIsOpen: cell.isOpen })}
        {...menuPortalProps(document.body)}
        ref={selectRef}
        isSearchable
        onMenuClose={() => onCellChanged({ ...cell, isOpen: !cell.isOpen, inputValue: undefined })}
        onMenuOpen={() => onCellChanged({ ...cell, isOpen: true })}
        onChange={(option) =>
          onCellChanged({ ...cell, selectedValue: option.value, isOpen: false, inputValue: undefined })
        }
        blurInputOnSelect
        defaultValue={selected}
        value={selected}
        isDisabled={cell.isDisabled}
        options={cell.values}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            selectRef.current.blur();
            onCellChanged({ ...cell, isOpen: false, inputValue: undefined });
          }
        }}
        components={{ Option, Menu }}
        styles={{
          container: merge('container', { width: '100%', height: '100%' }),
          control: merge('control', {
            border: 'none',
            borderColor: 'transparent',
            minHeight: '25px',
            background: 'transparent',
            boxShadow: 'none',
          }),
          indicatorsContainer: merge('indicatorsContainer', { paddingTop: '0px' }),
          dropdownIndicator: merge('dropdownIndicator', { padding: '0px 4px' }),
          singleValue: merge('singleValue', { color: 'inherit' }),
          indicatorSeparator: merge('indicatorSeparator', { marginTop: '4px', marginBottom: '4px' }),
          input: merge('input', { padding: 0 }),
          valueContainer: merge('valueContainer', { padding: '0 8px' }),
          menuPortal: menuPortalStyle,
        }}
      />
    </div>
  );
};
