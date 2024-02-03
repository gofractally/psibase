interface Func {
  service: string;
  method: string;
}

export interface CachedFunction extends Func {
  params: string;
  result: any;
}

export const cachedFunctions: CachedFunction[] = [
  // {
  //   service: "token-sys",
  //   method: "transfer",
  //   params: "3",
  //   result: "BlueCat came out?",
  // },
];

export const getImportedFunctions = (): Func[] => {
  return [
    {
      service: "token-sys",
      method: "transfer",
    },
  ];
};

const hash = (str: string) => str;

export const generateFulfiledFunction = (func: Func, result: any): string =>
  `export function ${func.method}(arg1, arg2, arg3) {
      return ${typeof result == "number" ? result : `'${result}'`}
    }`;

export const generatePendingFunction = (func: Func): string => {
  const id = hash(func.service + func.method);

  return `export async function ${func.method}(arg1, arg2, arg3) {

    const parentConnection = await connectToParent().promise;
    const toCall = {
      service: "${func.service}",
      method: "${func.method}",
      params: "this is hardcoded atm...",
    };


    console.log('attempting to call plugin call ${id}', parentConnection);
    parentConnection.pluginCall(toCall);
    throw new Error("Pending function throw, this is by design.")
      
    }
    
    `;
};
