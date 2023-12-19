import "./App.css";
import reactLogo from "./assets/react.svg";
import { helloWorld } from "./lib/hello.js";
import viteLogo from "/vite.svg";
import { connect } from "@psibase/plugin";
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  const init = async () => {
    const res = await connect({});
    console.log(res, "came back");
    const x = await res.functionCall({
      service: "",
      method: "",
      params: {},
    });
    console.log(res, "came back", x);
  };

  useEffect(() => {
    const res = helloWorld();
    init();
    console.log(res, "was res");
  }, []);

  return (
    <>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  );
}

export default App;
