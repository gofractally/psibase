import {
    FunctionCallResult,
  } from "@psibase/common-lib/messaging";

interface PluginFunc {
    service: string;
    plugin: string;
    intf?: string;
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
    result: string | number | object,
    argCount = 3
): string =>
    `export function ${method}(${argString(argCount)}) {
        return ${typeof result == "number" ? result : typeof result == "object" ? JSON.stringify(result) : `'${result}'`}
    }`;

const generatePendingFunction = (
    { service, plugin, intf, method }: PluginFunc,
    id: string
): string => {
    const functionBody = `
        const payload = {
            id: "${id}",
            service: "${service}",
            plugin: "${plugin}",
            method: "${method}",
            params: [...args]
        };

        console.log('Attempting to call plugin call ${id}', payload);
        window.parent.postMessage({ type: 'PLUGIN_CALL_FAILURE', payload }, "*");
        throw new Error("Pending function throw, this is by design.");
    `;

    return (typeof intf === 'undefined' || intf === "") ? `
        export async function ${method}(...args) {
            ${functionBody}
        }
    ` : `
        export const ${intf} = {
            async ${method}(...args) {
                ${functionBody}
            }
        };`;
};

type ImportedFunc = {
    'compIntf': string;
    'funcName': string;
};

type ImportedFuncs = ImportedFunc[];

export const adaptImports = (
    importedFuncs: ImportedFuncs,
    id: string,
    functionsResult: FunctionCallResult[]
): { [key: string]: string }[] => 
    importedFuncs.reduce((accumulator, { compIntf, funcName }) => {
        const functionResult = functionsResult.find(funcResult => funcResult.method == funcName);
        const [service, rest] = compIntf.split(':');
        const [plugin, intf] = rest.split('/');

        const value = functionResult
            ? generateFulfilledFunction(functionResult.method, functionResult.result)
            : generatePendingFunction({ service, plugin, intf, method: funcName }, id);
    
        accumulator.push({ [`${service}:${plugin}/*`]: value + "\n" });
    
        return accumulator;
    }, [] as { [key: string]: string }[]);
