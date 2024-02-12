import "./App.css";
import React, { useState } from "react";

import { Supervisor } from "@messaging";

const supervisor = new Supervisor();

function App() {
  const [res, setRes] = useState("Empty");

  const run = async () => {
    console.info("DemoApp1 connected to Supervisor");

    console.log("calling demoapp2.callintoplugin");
    const _res = await supervisor.functionCall({
      service: "demoapp2",
      method: "callintoplugin",
      params: [],
    });
    console.log("demosapp2.callintoplugin() returned:", _res);
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
