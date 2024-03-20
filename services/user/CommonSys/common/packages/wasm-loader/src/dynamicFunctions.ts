import { ResultCache, isErrorResult } from "@psibase/common-lib/messaging";

interface PluginFunc {
    service: string;
    plugin: string;
    intf?: string;
    method: string;
}

type FunctionInterface = {
    namespace: string,
    package: string,
    name: string,
    funcs: string[]
}

type ImportedFunctions = {
    namespace: string,
    package: string,
    interfaces: FunctionInterface[],
    funcs: string[]
}

const hostIntf = (intf: FunctionInterface): boolean => {
    return intf.namespace === "wasi" || intf.namespace === "common";
};

const getFunctionBody = (pluginFunc: PluginFunc, resultCache: ResultCache[]): string => {
    let {service, plugin, intf, method} = pluginFunc;
    const found = resultCache.find((f: ResultCache)=>{
        return f.callService == service
            && f.callPlugin == plugin
            && f.callIntf == intf
            && f.callMethod == method;
    });
    if (!found) {
        /*
        I uncovered this JCO issue: https://github.com/bytecodealliance/jco/issues/405
        Once fixed, I can just throw the following object:
            throw {
                type: 'synchronous_call',
                target: {
                    service: '${service}',
                    plugin: '${plugin}',
                    intf: '${intf}',
                    method: '${method}',
                    params: [...args]
                }
            };
        And catch / postMessage from the normal loader catch handler (and use buildPluginSyncCall).
        */
       
        return `
            window.parent.postMessage({
                    type: "SYNC_CALL_REQUEST",
                    payload: {
                        service: '${service}',
                        plugin: '${plugin}',
                        intf: '${intf}',
                        method: '${method}',
                        params: [...args],
                    },
                },
                window.location.origin.replace(/\\/\\/([^.]*)/, '//supervisor-sys')
            );
            throw {type: "sync_call"};
        `
    } else {
        if (found.result !== undefined) {
            if (isErrorResult(found.result)) {
                return `throw ${JSON.stringify(found.result.val)};`
            }
            else {
                return `return ${JSON.stringify(found.result)};`
            }
            
        } else {
            return ""; // No-op if the sync call has no return value.
        }
    }
};

export const getImportFills = (
    importedFuncs: ImportedFunctions,
    resultCache: ResultCache[]
): { [key: string]: string }[] => 
{
    const {interfaces, funcs: freeFunctions} = importedFuncs;
    if (freeFunctions.length !== 0) {
        // TODO: Check how this behaves if a plugin exports a freestanding function and
        //       another plugin imports it.
        throw Error(`Plugins may not import freestanding functions.`);
    }

    let importables: { [key: string]: string }[] = [];
    interfaces.forEach((intf: FunctionInterface) => {
        if (hostIntf(intf)) return;
        let imp : string[] = [];
        imp.push(`export const ${intf.name} = {
        `);
        intf.funcs.forEach((f: string)=>{
            // Todo - I can explicitly count args to generate args for
            //   the fulfilled function. Is it necessary?
            imp.push(`${f}(...args) {
            `);
            imp.push(getFunctionBody({service: intf.namespace, plugin: intf.package, intf: intf.name, method: f}, resultCache));
            imp.push(`},`);
        });
        imp.push(`}`);

        importables.push({ [`${intf.namespace}:${intf.package}/*`]: `${imp.join("")}` });
    });
    return importables;
}
