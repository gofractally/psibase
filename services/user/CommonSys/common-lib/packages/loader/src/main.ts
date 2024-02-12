import { buildMessageLoaderInitialized } from "../../../../common/messaging/supervisor/LoaderInitialized";
import {
  generateFulfilledFunction,
  generatePendingFunction,
  getImportedFunctions,
} from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import {
  PluginCallResponse,
  isPluginCallRequest,
  PluginCallRequest,
  buildPluginCallResponse,
  PluginCallPayload,
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
  console.info("runWasm().top 2");
  const { load } = await import("rollup-plugin-wit-component");

  console.time("Load");
  const mod = await load(
    // @ts-expect-error fff
    wasm,
    importables
  );
  console.timeEnd("Load");

  return mod[method](...params);
};

const functionCall = async ({
  id,
  args,
  precomputedResults,
}: PluginCallPayload) => {
  const url = "/loader/plugin.wasm";

  const wasmBytes = await fetch(url).then((res) => res.arrayBuffer());
  const importedFunctionsFromWit = getImportedFunctions();

  const fulfilledFunctions = precomputedResults.map((func) =>
    generateFulfilledFunction(func.method, func.result)
  );
  const missingFunctions = importedFunctionsFromWit.filter(
    (func) =>
      !precomputedResults.some(
        (f) => f.method == func.method && f.service == func.service
      )
  );

  const str =
    importableCode +
    `\n ${missingFunctions.map((missingFunction) =>
      generatePendingFunction(missingFunction, id)
    )} \n ${fulfilledFunctions}`;

  let importables: Importables[] = [
    {
      [`component:${args.service}/imports`]: str,
    },
  ];

  try {
    const res = await runWasm(wasmBytes, importables, args.method, args.params);
    sendPluginCallResponse(buildPluginCallResponse(id, res));
  } catch (e) {
    console.warn(`runWasm threw.`);
  }
};

const sendPluginCallResponse = (response: PluginCallResponse) => {
  window.parent.postMessage(response, "*");
};

const onPluginCallRequest = (request: PluginCallRequest) =>
  functionCall(request.payload);

const onRawEvent = (message: MessageEvent) => {
  if (isPluginCallRequest(message.data)) {
    onPluginCallRequest(message.data);
  }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), "*");
