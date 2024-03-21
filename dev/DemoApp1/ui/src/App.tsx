import "./App.css";
import { Supervisor } from "@psibase/common-lib/messaging";
import { useEffect, useState } from "react";

const supervisor = new Supervisor();

function App() {
  const [res, setRes] = useState("Empty");

  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadPlugins([
      { service: "invite-sys" },
      { service: "account-sys" },
      { service: "auth-sys" },
      { service: "demoapp1" },
    ]);
  };

  useEffect(() => {
    init();
  }, []);

  const run = async () => {
    const res = await supervisor.functionCall({
      service: "demoapp1",
      method: "helloworld",
      params: [],
    });
    setRes(res as string);
  };

  const run2 = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "demoapp1",
        intf: "intf",
        method: "helloworld2",
        params: [],
      });
      setRes(res as string);
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  return (
    <>
      <h1>Psibase Demo App 1</h1>
      <h3>{res}</h3>
      <div className="card">
        <button onClick={() => run()}>Say Hello</button>
      </div>

      <div className="card">
        <button onClick={() => run2()}>Say Hello 2</button>
      </div>
    </>
  );
}

export default App;
