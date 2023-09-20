import React, {Component, useEffect, useState} from 'react';
import PropTypes from 'prop-types';
import { ReactGrid,  Highlight  } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "../styles.css"
import { length } from 'ramda';
import   CustomNumberCellTemplate  from './CustomNumberCell';
import PercentCellTemplate  from './PercentCell';

const createCellByType = (column,value,columnStyle,columnNonEditable)=>{
  
  switch(column.type){
   case 'text':
     return {type:column.type,text:value||'',style:columnStyle,nonEditable:columnNonEditable}
   case 'number':
     return {type:'customnumber',value:value,style:columnStyle,nonEditable:columnNonEditable}
     case 'percent':
      return {type:'percent',value:value,style:columnStyle,nonEditable:columnNonEditable,format:new Intl.NumberFormat(window.navigator.language, {style: "percent",maximumFractionDigits:15,maximumSignificantDigits:15})}
     case 'date':
     return {type:column.type,date:Date(value),style:columnStyle,nonEditable:columnNonEditable}
     case 'time':
      return {type:column.type,time:Date(value),style:columnStyle,nonEditable:columnNonEditable}
 }
}
const CustomCellTemplates = {'percent':new PercentCellTemplate(),'customnumber': new CustomNumberCellTemplate()}

const getCellDataByType = (type,cell)=>{
  switch(type){
   case 'text':
     return cell.text 
   case 'number':
   case 'percent':
     return cell.value
   case 'date':
     return cell.date
     case 'time':
      return cell.time
 }
}

const alignToStyle =(align)=>{
  switch(align)
  {
    case "left": return {"justify-content":"flex-start"};
    case "center": return {"justify-content":"center"};
    case "right": return {"justify-content":"flex-end"};
  }
}


const isMacOs = () => window.navigator.appVersion.indexOf("Mac") !== -1;

const DashReactGrid = props =>{
        const {id, columns, data,enableFillHandle, enableRangeSelection,enableRowSelection, enableColumnSelection, highlights, stickyLeftColumns,
        stickyRightColumns,
        stickyTopRows,
        stickyBottomRows,
        selectedCell, style, styleHeader, setProps} =props;
        const columnIds = columns.map((column)=>column["columnId"])
        const rows = []
        const [thisRows, setRows] = useState(rows)
        const [thisData, setData] = useState(data)
        const [cellChangesIndex, setCellChangesIndex] = useState(() => -1);
        const [cellChanges, setCellChanges] = useState(() => []);
        const columnsStyle = columns.map((column)=>({...column.align ? alignToStyle(column.align):null,...column.style}))
        const simpleHandleContextMenu = (
          selectedRowIds,
          selectedColIds,
          selectionMode,
          menuOptions
        ) => {
          return menuOptions;
        }
        
        const undoChanges = (
          changes, data
        ) => {
          const updated = applyNewValue(changes, data, true);
          setCellChangesIndex(cellChangesIndex - 1);
          return updated;
        };

        const redoChanges = (
          changes,data
        ) => {
          const updated = applyNewValue(changes, data);
          setCellChangesIndex(cellChangesIndex + 1);
          return updated;
        };

      

        const headerRow = {
          rowId: "header",
          cells: columns.map((column)=>( 
            { type: "header", 
              text: column.title, 
              style: {...styleHeader,...(column.align ? alignToStyle(column.align):null),...column.style} || null } 
            )
            )
          }
        const applyNewValue = (
          changes,
          data,
          usePrevValue = false
        ) => {
          let newData = structuredClone(data);
          changes.forEach((change) => {
            const fieldName = change.columnId;
            const columnIndex = columnIds.indexOf(fieldName)
            const Index = change.rowId;
            const cell = usePrevValue ? change.previousCell : change.newCell;
            if(Index>=length(newData))
            {
              const emptyRow = columns.map((column)=>null)
              newData.push(...Array(Index-length(newData)+1).fill(emptyRow))
            }
            newData[Index][columnIndex] = getCellDataByType(columns[columnIndex].type,cell)
          });
          
          return newData;
        };

        const handleUndoChanges = () => {
          if (cellChangesIndex >= 0) {
            const newData = undoChanges(cellChanges[cellChangesIndex], data)
            createRows(newData)
            setData(newData)
            setProps({data:newData})
          }
        };
      
        const handleRedoChanges = () => {
          if (cellChangesIndex + 1 <= cellChanges.length - 1) {
            const newData = redoChanges(cellChanges[cellChangesIndex + 1], data)
            createRows(newData)
            setData(newData)
            setProps({data:newData})
          }
        };
     
        const handleFocusLocationChanged = location =>{
          setProps({selectedCell:location})
        }
      
        
        const createRow = (idx,data_row)=>{
          return (
          {
            rowId:idx, 
            cells : data_row.map( (data_item, col_num) => ( createCellByType(columns[col_num],data_item,columnsStyle[col_num],columns[col_num].nonEditable)))

          })
        }
        const createRows = (data)=>(
          setRows( [
          headerRow,
          ...data.map( (data_row,idx)=>(
          createRow(idx,data_row)
        ))])
        );

        useEffect(()=>{
            createRows(data)
        }, [data])

        const applyChanges = (changes,data)=>{
          const newData = structuredClone(data);
            changes.forEach((change)=>
            {
                const fieldName = change.columnId;
                const columnIndex = columnIds.indexOf(fieldName)
                const Index = change.rowId;
                newData[Index][columnIndex] = getCellDataByType(columns[columnIndex].type,change.newCell)
            })
            setData(newData)
            createRows(newData)
            setProps({data:newData})
            setCellChanges([...cellChanges.slice(0, cellChangesIndex + 1), changes]);
            setCellChangesIndex(cellChangesIndex + 1);
        }
        
        const handleChanges = (changes) => { 
          applyChanges(changes,data)
          }; 
        return (
            <div id={id} style={style} onKeyDown={(e) => {
              if ((!isMacOs() && e.ctrlKey) || e.metaKey) {
                switch (e.key) {
                  case "z":
                    handleUndoChanges();
                    return;
                  case "y":
                    handleRedoChanges();
                    return;
                }
              }
            }}>
                <ReactGrid rows={thisRows} columns={columns} onCellsChanged = {handleChanges} onFocusLocationChanged={handleFocusLocationChanged} enableFillHandle = {enableFillHandle} enableRangeSelection ={enableRangeSelection} enableRowSelection={enableRowSelection} enableColumnSelection={enableColumnSelection} 
                onContextMenu={simpleHandleContextMenu} highlights={highlights}
                stickyLeftColumns={stickyLeftColumns}
		            stickyRightColumns={stickyRightColumns}
		            stickyTopRows={stickyTopRows}
		            stickyBottomRows={stickyBottomRows}
                customCellTemplates= {CustomCellTemplates}
                />
            </div>
        );
    }

DashReactGrid.defaultProps = {enableFillHandle:true,enableRangeSelection:true,enableRowSelection:true,enableColumnSelection:true,
  stickyLeftColumns:0,
  stickyRightColumns:0,
  stickyTopRows:0,
  stickyBottomRows:0,
  highlights:null
}

;

DashReactGrid.propTypes = {
    /**
     * The ID used to identify this component in Dash callbacks.
     */
    id: PropTypes.string,

    /**
     * A label that will be printed when this component is rendered.
     */
    columns: PropTypes.any.isRequired,

    /**
     * The value displayed in the input.
     */
    data: PropTypes.any.isRequired,


    stickyLeftColumns: PropTypes.number,
        stickyRightColumns: PropTypes.number,
        stickyTopRows: PropTypes.number,
        stickyBottomRows: PropTypes.number,
    enableFillHandle: PropTypes.bool,
    enableRangeSelection: PropTypes.bool,
    enableRowSelection: PropTypes.bool,
    enableColumnSelection: PropTypes.bool,
    highlights: PropTypes.any,
    selectedCell: PropTypes.any,
    /**
     * The style of the container (div)
     */
        style: PropTypes.object,
        styleHeader: PropTypes.object,
    /**
     * Dash-assigned callback that should be called to report property changes
     * to Dash, to make them available for callbacks.
     */
        setProps: PropTypes.func
};

export default DashReactGrid