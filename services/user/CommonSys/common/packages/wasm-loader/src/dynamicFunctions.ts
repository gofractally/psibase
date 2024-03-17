import { FunctionCallResult } from "@psibase/common-lib/messaging";

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
        throw JSON.stringify({
            type: 'synchronous_call',
            target: {
                id: '${id}',
                service: '${service}',
                plugin: '${plugin}',
                intf: '${intf}',
                method: '${method}',
                params: [...args]
            }
        });
    `;

    return typeof intf === "undefined" || intf === ""
        ? `
        export function ${method}(...args) {
            ${functionBody}
        } `
        : `
        export const ${intf} = {
            ${method}(...args) {
                ${functionBody}
            }
        };`;
};

type ImportedFunc = {
    namespace: string;
    package: string;
    intf?: string;
    funcName: string;
};

type ImportedFuncs = ImportedFunc[];

const hostImport = (imported: ImportedFunc): boolean => {
    return imported.namespace === "wasi" || imported.namespace === "common";
};

export const adaptImports = (
    importedFuncs: ImportedFuncs,
    id: string,
    functionsResult: FunctionCallResult[]
): { [key: string]: string }[] =>
    importedFuncs.reduce(
        (accumulator, imported) => {
            if (hostImport(imported)) return accumulator;

            const res = functionsResult.find(
                (funcResult) =>
                    funcResult.intf === imported.intf &&
                    funcResult.method === imported.funcName
            );

            let service = imported.namespace;
            let plugin = imported.package;
            const { intf, funcName: method } = imported;
            const code = res
                ? generateFulfilledFunction(res.method, res.result)
                : generatePendingFunction(
                      { service, plugin, intf, method },
                      id
                  );

            accumulator.push({ [`${service}:${plugin}/*`]: code + "\n" });

            return accumulator;
        },
        [] as { [key: string]: string }[]
    );
