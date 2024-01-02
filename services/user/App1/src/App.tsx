import "./App.css";
import { connect } from "@psibase/plugin";

function App() {
  const run = async () => {
    const res = await connect();

    console.log(res, "came back");
    const back = await res.functionCall({
      service: "app2",
      method: "",
      params: {},
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
