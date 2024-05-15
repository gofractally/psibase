import { isErrorResult } from "@psibase/common-lib/messaging";
import { ResultCache } from "@psibase/supervisor-lib";

interface PluginFunc {
    service: string;
    plugin: string;
    intf?: string;
    method: string;
}

type FunctionInterface = {
    namespace: string;
    package: string;
    name: string;
    funcs: string[];
};

type ImportedFunctions = {
    namespace: string;
    package: string;
    interfaces: FunctionInterface[];
    funcs: string[];
};

const hostIntf = (intf: FunctionInterface): boolean => {
    return intf.namespace === "wasi" || intf.namespace === "common";
};

const getFunctionBody = (
    pluginFunc: PluginFunc,
    resultCache: ResultCache[],
): string => {
    let { service, plugin, intf, method } = pluginFunc;
    const found = resultCache.find((f: ResultCache) => {
        return (
            f.callService == service &&
            f.callPlugin == plugin &&
            f.callIntf == intf &&
            f.callMethod == method
        );
    });

    if (!found) {
        return `
            throw new Error(JSON.stringify({
                type: 'synchronous_call',
                target: {
                    service: '${service}',
                    plugin: '${plugin}',
                    intf: '${intf}',
                    method: '${method}',
                    params: [...args]
                }}));
        `;
    }

    if (found.result === undefined) {
        return ""; // No-op if the sync call has no return value.
    }

    if (isErrorResult(found.result)) {
        return `throw ${JSON.stringify(found.result.val)};`;
    } else {
        return `return ${JSON.stringify(found.result)};`;
    }
};

interface PkgId {
    ns: string;
    pkg: string;
}
const serializePkgId = (pkgId: PkgId): string => `${pkgId.ns}:${pkgId.pkg}`;
interface FunctionIntfs {
    [pkgId: string]: FunctionInterface[];
}
const autoArrayInit = {
    get: (target: FunctionIntfs, pkgId: string): FunctionInterface[] => {
        if (!target[pkgId]) {
            target[pkgId] = [];
        }
        return target[pkgId];
    },
};

export const getImportFills = (
    importedFuncs: ImportedFunctions,
    resultCache: ResultCache[],
): { [key: string]: string }[] => {
    const { interfaces, funcs: freeFunctions } = importedFuncs;
    if (freeFunctions.length !== 0) {
        // TODO: Check how this behaves if a plugin exports a freestanding function and
        //       another plugin imports it.
        throw Error(`TODO: Plugins may not import freestanding functions.`);
    }

    let importables: { [key: string]: string }[] = [];
    let subset = interfaces.filter((i) => {
        return !hostIntf(i) && !(i.funcs.length === 0);
    });

    let namespaced: FunctionIntfs = new Proxy({}, autoArrayInit);
    subset.forEach((intf: FunctionInterface) => {
        let key: PkgId = { ns: intf.namespace, pkg: intf.package };
        namespaced[serializePkgId(key)].push(intf);
    });

    for (const [pkgId, intfs] of Object.entries(namespaced)) {
        let imp: string[] = [];
        intfs.forEach((intf: FunctionInterface) => {
            imp.push(`export const ${intf.name} = {
            `);
            intf.funcs.forEach((f: string) => {
                imp.push(`${f}(...args) {
                `);
                imp.push(
                    getFunctionBody(
                        {
                            service: intf.namespace,
                            plugin: intf.package,
                            intf: intf.name,
                            method: f,
                        },
                        resultCache,
                    ),
                );
                imp.push(`},`);
            });
            imp.push(`}`);
        });
        importables.push({ [`${pkgId}/*`]: `${imp.join("")}` });
    }
    return importables;
};
