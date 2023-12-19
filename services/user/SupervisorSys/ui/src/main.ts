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
