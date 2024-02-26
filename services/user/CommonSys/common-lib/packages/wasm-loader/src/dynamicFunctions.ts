export interface Func {
  service: string;
  method: string;
}

export const getImportedFunctions = (): Func[] => {
  return [
    {
      service: "token-sys",
      method: "transfer",
    },
  ];
};

const argString = (count: number) =>
  [...new Array(count)]
    .map((_, index) => index + 1)
    .map((num) => `arg${num}`)
    .join(", ")
    .trim();

export const generateFulfilledFunction = (
  method: string,
  result: string | number,
  argCount = 3
): string =>
  `export function ${method}(${argString(argCount)}) {
        return ${typeof result == "number" ? result : `'${result}'`}
      }`;

export interface FunctionCallArgs {
  service: string;
  method: string;
  params: any[];
}
export interface FunctionCallResult<T = any> extends FunctionCallArgs {
  id: string;
  result: T;
}

export const generatePendingFunction = ({ method, service }: Func, id: string): string => {
  return `export async function ${method}(...args) {
  console.log('pendingFunctionRan');
  
  const payload = {
      id: "${id}",
      service: "${service}",
      method: "${method}",
      params: [...args]
  };
  
  console.log('Attempting to call plugin call ${id}', payload);
  window.parent.postMessage({ type: 'PLUGIN_CALL_FAILURE', payload }, "*");
  throw new Error("Pending function throw, this is by design.")
  }
`;
};
