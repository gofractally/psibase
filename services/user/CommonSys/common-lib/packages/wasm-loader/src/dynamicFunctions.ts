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

export const generatePendingFunction = (func: Func, id: string): string => {
  return `export async function ${func.method}(...args) {
      console.log('pendingFunctionRan');
  
      const payload = {
          service: "${func.service}",
          method: "${func.method}",
          params: [...args],
          id: "${id}",
      };
  
      console.log('attempting to call plugin call ${id}', payload);
      window.parent.postMessage({ type: 'PLUGIN_CALL_REQUEST', payload }, "*");
      throw new Error("Pending function throw, this is by design.")
      }
      
      `;
};
