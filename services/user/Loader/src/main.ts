import importableCode from "./importables.js?raw";
import {
  FunctionCallArgs,
  PluginCallResponse,
  isPluginCallRequest,
  PluginCallRequest,
  buildPluginCallResponse,
  FunctionCallResult,
} from "@messaging";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>Loader</h1>
    <p>This is a generated SPA designed to act as the loader, its sole purpose is to be rendered in an iframe and run a WASM Component, then execute functions in the WASM component and send the results back to its parent iframe.</p>
  </div>
`;

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

const functionCall = async (
  id: string,
  param: FunctionCallArgs,
  cached: FunctionCallResult[]
) => {
  const url = "/loader/plugin.wasm";

  const wasmBytes = await fetch(url).then((res) => res.arrayBuffer());

  let importables: Importables[] = [
    { [`component:${param.service}/imports`]: importableCode },
  ];

  const res = await runWasm(wasmBytes, importables, param.method, param.params);

  const message = buildPluginCallResponse(id, res);
  sendPluginCallResponse(message);
  return res;
};

const sendPluginCallResponse = (response: PluginCallResponse) => {};

const onPluginCallRequest = (request: PluginCallRequest) => {
  // I still need to pre-build the shit here....
};

const onRawEvent = (message: MessageEvent) => {
  if (isPluginCallRequest(message.data)) {
    onPluginCallRequest(message.data);
  }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(
  {
    type: "LOADER_INITIALIZED",
    payload: {},
  },
  "*"
);
