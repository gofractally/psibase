import "./App.css";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import { connect } from "@psibase/plugin";
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  const init = async () => {
    const res = await connect();

    const func = await res.functionCall({
      service: "hello",
      method: "",
      params: {},
    });

    console.log(res, "was back", func);
  };

  useEffect(() => {
    init();
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
