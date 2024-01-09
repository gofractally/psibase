import "./App.css";

// import { connect } from "@psibase/plugin";

function App() {
  // const run = async () => {
  //   const res = await connect();

  //   console.log(res, "about to call demoapp2.functionCall");
  //   const back = await res.functionCall({
  //     service: "demoapp2",
  //     method: "callintoplugin",
  //     params: [],
  //   });
  //   console.log(back, "came back on demoapp2?");
  // };

  return (
    <>
      <h1>Psibase Demo App 2</h1>
      {/* <div className="card">
        <button onClick={() => run()}>Say Hello</button>
      </div> */}
    </>
  );
}

export default App;
