interface Func {
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

export const generateFulfilledFunction = (
  method: string,
  result: string | number
): string =>
  `export function ${method}(arg1, arg2, arg3) {
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
