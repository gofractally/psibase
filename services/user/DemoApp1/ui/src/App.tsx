import "./App.css";
import { connect } from "@psibase/plugin";

function App() {
  const run = async () => {
    const res = await connect();
    console.info("DemoApp1 connected to Supervisor");

    console.log("calling demoapp2.callintoplugin");
    const back = await res.functionCall({
      service: "demoapp2",
      method: "callintoplugin",
      params: [],
    });
    console.log("demosapp2.callintoplugin() returned:", back);
  };

  return (
    <>
      <h1>Psibase Demo App 1</h1>
      <div className="card">
        <button onClick={() => run()}>Say Hello</button>
      </div>
    </>
  );
}

export default App;
