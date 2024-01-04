import { connectToParent } from "penpal";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>App 2</h1>
    <p>Test</p>
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

  const { load } = await import("rollup-plugin-wit-component");

  const url = "./functions.wasm";

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


// Rust function

const rustFunction = () => {
  // do stuff
  // 
  this.addActions(['fwefweh']);

  setTimeout(() => {
    this.addActions(['fewfew'], 3000)
  })
}