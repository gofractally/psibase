import { useEffect } from "react";
import { $init, provider } from "./graph";

const App = () => {
  const run = async () => {
    $init.then(async () => {
      const Graph = new provider.Graph();

      if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
        globalThis.Graph = Graph;
      }

      const url =
        "https://account-sys.psibase.127.0.0.1.sslip.io:8080/loader/plugin.wasm";
      const file = await fetch(url);
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

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
