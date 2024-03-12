import { generateSubdomain } from "./main";
import { ServiceMethodIndex } from "./witParsing";

interface Func {
    service: string;
    method: string;
}

const argString = (count: number) =>
    [...new Array(count)]
        .map((_, index) => index + 1)
        .map((num) => `arg${num}`)
        .join(", ")
        .trim();

const generateFulfilledFunction = (
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

const generatePendingFunction = (
    { method, service }: Func,
    id: string,
    origin: string
): string => {
    return `export async function ${method}(...args) {
  
  const payload = {
      id: "${id}",
      service: "${service}",
      method: "${method}",
      params: [...args]
  };
  
  console.log('Attempting to call plugin call ${id}', payload);
  window.parent.postMessage({ type: 'PLUGIN_CALL_FAILURE', payload }, "${origin}");
  throw new Error("Pending function throw, this is by design.")
  }
`;
};

interface FunctionResult<T = any> {
    method: string;
    result: T;
}

export const serviceMethodIndexToImportables = (
    serviceMethodIndex: ServiceMethodIndex,
    service: string,
    id: string,
    functionsResult: FunctionResult[]
): { [key: string]: string }[] =>
    Object.entries(serviceMethodIndex).map(([key, methodNames]) => ({
        [`component:${service}/${key}`]: methodNames
            .map((methodName) => {
                const functionResult = functionsResult.find(
                    (funcResult) => funcResult.method == methodName
                );
                return (
                    (functionResult
                        ? generateFulfilledFunction(
                              functionResult.method,
                              functionResult.result
                          )
                        : generatePendingFunction(
                              { method: methodName, service: key },
                              id,
                              generateSubdomain("supervisor-sys")
                          )) + "\n"
                );
            })
            .join("\n")
    }));
