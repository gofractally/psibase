import "./App.css";
import { Supervisor } from "@psibase/common-lib";
import { SchemaUI } from "./SchemaUI";

const supervisor = new Supervisor();

function App() {
  return (
    <>
      <h1>Plugin tester</h1>
      <SchemaUI supervisor={supervisor} />
    </>
  );
}

export default App;
