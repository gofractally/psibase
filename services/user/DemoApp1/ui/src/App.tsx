import "./App.css";
import { connect } from "@psibase/plugin";

function App() {
  const run = async () => {
    const res = await connect();

    console.log(res, "about to call functionCall");
    const back = await res.functionCall({
      service: "account-sys",
      method: "call",
      params: [],
    });
    console.log(back, "came back on app2?");
  };

  return (
    <>
      <h1>Psibase App Demo</h1>
      <div className="card">
        <button onClick={() => run()}>Say Hello</button>
      </div>
    </>
  );
}

export default App;
