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

const functionCall = async (param: FunctionCallParam) => {
  if (!isValidFunctionCallParam(param))
    throw new Error(`Invalid function call param.`);

  console.log("loading js... new hcange!");
  const { load } = await import("rollup-plugin-wit-component");

  // account.sys.psibase.io/loader
  const url = "/loader/functions.wasm";

  console.log("fetching wasm...");
  const wasmBytes = await fetch(url).then((res) => res.arrayBuffer());

  // const importableCode = `export function prnt(string) {
  //   console.log('from imported code: ', string);
  // };`;

  let importables = [
    { [`component:${param.service}/imports`]: importableCode },
  ];

  console.log("loading wasm...");

  console.time("Load");
  const { mod, imports, exports, files } = await load(
    // @ts-expect-error fff
    /* @vite-ignore */ wasmBytes,
    importables
  );
  console.timeEnd("Load");

  console.log(mod, "is the module I have", { imports, exports, files });
  return mod[param.method](...param.params);
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
