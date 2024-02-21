import "./App.css";
import { Supervisor } from "@messaging";
import { useEffect, useState } from "react";

const supervisor = new Supervisor();

function App() {
  const [res, setRes] = useState("Empty");

  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadServices(["demoapp2"]);
  };

  useEffect(() => {
    init();
  }, []);

  const run = async () => {
    console.info("DemoApp1 connected to Supervisor");

    console.log("calling demoapp2.callintoplugin");
    const res = await supervisor.functionCall({
      service: "demoapp1",
      method: "hello-world",
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
    </>
  );
}

export default App;
