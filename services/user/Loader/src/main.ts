import {
  CachedFunction, // CachedFunction,
  generateFulfiledFunction,
  generatePendingFunction,
  getImportedFunctions,
} from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import { connectToParent } from "penpal";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>App 2 / Loader</h1>
    <p>This is a generated SPA designed to act as the loader, its sole purpose is to be rendered in an iframe and run a WASM Component, then execute functions in the WASM component and send the results back to its parent iframe.</p>
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

// const wasmUrl = (service: string) => `./${service}.wasm`;

// 1. pendingFunction generator
// 2. Create environment where cached data is available in the JS importables environment during runtime.
//

type Result<T = any> = { tag: "Ok"; value: T } | { tag: "Loading" };

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
  const { mod, imports, exports, files } = await load(
    // @ts-expect-error fff
    wasm,
    importables
  );
  console.timeEnd("Load");

  console.log(mod, "is the module I have", { imports, exports, files });
  return mod[method](...params);
};

const functionCall = async (
  param: FunctionCallParam,
  cachedFunctions: CachedFunction[]
): Promise<Result> => {
  if (!isValidFunctionCallParam(param))
    throw new Error(`Invalid function call param.`);

  const url = "/loader/plugin.wasm";

  console.log("fetching wasm...");
  const wasmBytes = await fetch(url).then((res) => res.arrayBuffer());

  const importedFunctionsFromWit = getImportedFunctions();
  console.log({ importedFunctionsFromWit, cachedFunctions });
  const fulfilledFunctions = cachedFunctions.map((func) =>
    generateFulfiledFunction(func, func.result)
  );
  const missingFunctions = importedFunctionsFromWit.filter(
    (func) =>
      !cachedFunctions.some(
        (f) => f.method == func.method && f.service == func.service
      )
  );

  const str =
    importableCode +
    `\n ${missingFunctions.map(
      generatePendingFunction
    )} \n ${fulfilledFunctions}`;

  let importables: Importables[] = [
    {
      [`component:${param.service}/imports`]: str,
    },
  ];

  console.log(
    `${missingFunctions.length} pending functions. ${fulfilledFunctions.length} fulfilled functions. ${missingFunctions} ${fulfilledFunctions}`
  );

  try {
    // this is returning the data back to the supervisor-sys
    const res = await runWasm(
      wasmBytes,
      importables,
      param.method,
      param.params
    );
    return {
      tag: "Ok",
      value: res,
    };
  } catch (e) {
    // this will occur when a pending function is called, which is known to fail
    // we need to run it again, with a fulfilled function instead.
    console.log(connection, "is the connection we got access too.");

    // return back to the supervisor that we're unsuccessful, assuming its because the cache isn't expansive enough yet.
    // the supervisor can see this, give it's cache more time to build and then try again.
    return {
      tag: "Loading",
    };
  }
};

const connection = connectToParent({
  methods: {
    functionCall,
  },
});

connection.promise.then((parent) => {
  console.log("Loader got parent", parent);
  // @ts-ignore
  parent.add(3, 1).then((total) => console.log(total));
});
