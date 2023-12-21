import { helloWorld } from "./lib/hello.js";
import { connectToParent } from "penpal";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    SupervisorSys
  </div>
`;

interface FunctionCallParam<T = any> {
  service: string;
  method: string;
  params: T;
}

const isValidFunctionCallParam = (param: any): param is FunctionCallParam =>
  typeof param === "object" &&
  param !== null &&
  "service" in param &&
  "method" in param &&
  "params" in param;

const functionCall = async (param: FunctionCallParam) => {
  if (!isValidFunctionCallParam(param))
    throw new Error(`Invalid function call param.`);
  console.log(param, "I should handle");

  const res = await helloWorld();
  return res;
};

const connection = connectToParent({
  methods: {
    functionCall,
  },
});

connection.promise.then((parent) => {
  // @ts-ignore
  parent.add(3, 1).then((total) => console.log(total));
});

// Create an iframe with a source of https://app.psibase.io/plugin.html
// and append it to the DOM.
//
// For POC purposes we will include the plugin.html
// It will request the WASM component from https://app.psibase.io/plugin.wasm (Which needs to be manually uploaded for now for the POC)
// It also listens for window.postMessage through penpal, and it will transpile the wasm
// Listening for window.postMessage it will WASM.transfer('alice', 'bob', 3, 'tokens man!');
//

// Await the compiled WASM
// Just create a vanilla VITE and figure out how to transpile it in the vanilla world.
// Function is called `call` no params, returns a string
