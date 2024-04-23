import "./App.css";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import { Supervisor } from "@psibase/common-lib/messaging";
import { useEffect, useState } from "react";

const supervisor = new Supervisor();

function App() {
  const [count, setCount] = useState(0);

  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadPlugins([
      { service: "invite" },
      { service: "accounts" },
      { service: "auth-sig" },
      { service: "demoapp1" },
    ]);
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
