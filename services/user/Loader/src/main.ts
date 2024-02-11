import importableCode from "./importables.js?raw";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>Loader</h1>
    <p>This is a generated SPA designed to act as the loader, its sole purpose is to be rendered in an iframe and run a WASM Component, then execute functions in the WASM component and send the results back to its parent iframe.</p>
  </div>
`;

interface FunctionCallParam<T = any> {
  service: string;
  method: string;
  params: T;
}

// const wasmUrl = (service: string) => `./${service}.wasm`;

// 1. pendingFunction generator
// 2. Create environment where cached data is available in the JS importables environment during runtime.
//

interface Importables {
  [key: string]: string;
}

const runWasm = async (
  wasm: ArrayBuffer,
  importables: Importables[],
  method: string,
  params: any[]
) => {
  const { load } = await import("rollup-plugin-wit-component");

  console.time("Load");
  const mod = await load(
    // @ts-expect-error fff
    wasm,
    importables
  );
  console.timeEnd("Load");

  console.log(mod, "is the module I have");
  return mod[method](...params);
};

const functionCall = async (param: FunctionCallParam) => {
  const url = "/loader/plugin.wasm";

  console.log("fetching wasm...");
  const wasmBytes = await fetch(url).then((res) => res.arrayBuffer());

  let importables: Importables[] = [
    { [`component:${param.service}/imports`]: importableCode },
  ];

  const res = await runWasm(wasmBytes, importables, param.method, param.params);
  return res;
};

const onRawEvent = (message: MessageEvent) => {
  console.log({ rawMessageLoader: message });
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(
  {
    type: "LOADER_INITIALIZED",
    payload: {},
  },
  "*"
);
