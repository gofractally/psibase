import "./App.css";
import { Supervisor } from "@psibase/common-lib/messaging";
import { useEffect, useState } from "react";

const supervisor = new Supervisor();

function App() {
  const [res, setRes] = useState("Empty");

  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadServices(["invite-sys", "account-sys", "auth-sys"]);
  };

  useEffect(() => {
    init();
  }, []);

  const run = async () => {
    console.log("calling demoapp1.helloworld");
    const res = await supervisor.functionCall({
      service: "demoapp1",
      method: "helloworld",
      params: [],
    });
    setRes(res as string);
  };

  const run2 = async () => {
    console.log("calling demoapp1.generateinvite");
    const res = await supervisor.functionCall({
      service: "demoapp1",
      intf: "intf",
      method: "helloworld2",
      params: [],
    });
    setRes(res as string);
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
