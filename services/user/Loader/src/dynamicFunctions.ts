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

export const generateFulfilledFunction = (func: Func, result: any): string =>
  `export function ${func.method}(arg1, arg2, arg3) {
        return ${typeof result == "number" ? result : `'${result}'`}
      }`;

export const generatePendingFunction = (func: Func, id: string): string => {
  return `export async function ${func.method}(...args) {
      console.log('pendingFunctionRan');
  
      const payload = {
        params: {      
          service: "${func.service}",
          method: "${func.method}",
          params: [...args]
        },
        context: { id: "${id}" }
      };
  
      console.log('attempting to call plugin call ${id}', payload);
      window.parent.postMessage({ type: 'PluginCall', payload }, "*");
      throw new Error("Pending function throw, this is by design.")
      }
      
      `;
};
