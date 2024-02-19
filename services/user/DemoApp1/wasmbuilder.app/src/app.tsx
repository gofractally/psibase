import { useEffect } from "react";
import { $init, provider } from "./graph";

const App = () => {
  const run = async () => {
    $init.then(async () => {
      console.log("f");
      const Graph = new provider.Graph();

      if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
        globalThis.Graph = Graph;
      }

      const url =
        "https://account-sys.psibase.127.0.0.1.sslip.io:8080/loader/plugin.wasm";
      const file = await fetch(url);
      console.log(file, "was received");
      const arrayBuffer = await file.arrayBuffer();
      console.log({ arrayBuffer });
      const bytes = new Uint8Array(arrayBuffer);

      console.log(Graph, "is the graph...");
      const component = Graph.addComponent("hello", bytes);

      console.log({ array: bytes, component });
    });
  };

  useEffect(() => {
    run();
  }, []);

  return (
    <>
      <div>hello world</div>
    </>
  );
};

export default App;
