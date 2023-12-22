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

const wasmUrl = (service: string) => `./${service}.wasm`;

const functionCall = async (param: FunctionCallParam) => {
  if (!isValidFunctionCallParam(param))
    throw new Error(`Invalid function call param.`);

  const { service } = param;

  const { load } = await import("rollup-plugin-wit-component");

  const url = wasmUrl(service);

  const wasmBytes = await fetch(url).then((res) => res.arrayBuffer());

  // @ts-expect-error fff
  const module = await load(/* @vite-ignore */ wasmBytes);

  return module.call();
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
