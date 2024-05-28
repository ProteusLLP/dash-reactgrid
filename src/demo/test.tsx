import * as React from "react";
import { render } from "react-dom";
import { ReactGrid, Column, Row, Highlight } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import "./styles.css";

interface Person {
  name: string;
  surname: string;
}

const getPeople = (): Person[] => [
  { name: "Thomas", surname: "Goldman" },
  { name: "Susie", surname: "Quattro" },
  { name: "", surname: "" }
];

const getColumns = (): Column[] => [
  { columnId: "name", width: 150 },
  { columnId: "surname", width: 150 }
];

const headerRow: Row = {
  rowId: "header",
  cells: [
    { type: "header", text: "Name" },
    { type: "header", text: "Surname" }
  ]
};

const getRows = (people: Person[]): Row[] => [
  headerRow,
  ...people.map<Row>((person, idx) => ({
    rowId: idx,
    cells: [
      { type: "text", text: person.name },
      { type: "text", text: person.surname }
    ]
  }))
];

const highlights: Highlight[] = [
  { columnId: "name", rowId: 0, borderColor: "#00ff00" },
  { columnId: "surname", rowId: 1, borderColor: "#0000ff" },
  { columnId: "name", rowId: 2, borderColor: "#ff0000" }
];

function App() {
  const [people] = React.useState<Person[]>(getPeople());
  const rows = getRows(people);
  const columns = getColumns();

  return <ReactGrid rows={rows} columns={columns} highlights={highlights} />;
}

render(<App />, document.getElementById("root"));
