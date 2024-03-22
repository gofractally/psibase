import { getImportFills } from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import {
    isPluginCallRequest,
    PluginCallPayload,
    buildPluginCallResponse,
    buildMessageLoaderInitialized,
    QualifiedFunctionCallArgs,
    isPreloadStartMessage,
    LoaderPreloadStart,
    buildPreloadCompleteMessage,
    toString
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib";
import { CallCache } from "./callCache";
import { load } from "rollup-plugin-wit-component";
import { DownloadFailed, InvalidPlugin, ParserDownloadFailed, ParsingFailed, PluginDownloadFailed, handleErrors } from "./errorHandling";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>WASM Loader</h1>
    <p>This is a generated SPA designed to act as the loader, its sole purpose is to be rendered in an iframe and run a WASM Component, then execute functions in the WASM component and send the results back to its parent iframe.</p>
  </div>
`;

const supervisorDomain = siblingUrl(null, "supervisor-sys");

interface Importables {
    [key: string]: string;
}

const wasmUrlToIntArray = (url: string) =>
    fetch(url)
        .then((res) => {
            if (!res.ok)
                throw new DownloadFailed(url);
            return res.arrayBuffer()
        })
        .then((buffer) => new Uint8Array(buffer));

const parserCacheKey: string = "component-parser";
const componentParser = async () => {
    if (!cache.exists(parserCacheKey)) {
        let parserBytes: Uint8Array;
        try {
            parserBytes = await wasmUrlToIntArray(
                "/common/component_parser.wasm"
            );
        } catch (e) {
            console.error("Loader: component_parser download failed");
            throw new ParserDownloadFailed();
        }
        // Performance improvement: Target wasm32-unknown-unknown when compiling
        //   parser instead of wasm32-wasi, then loading can be simplified without wasi
        //   shims.
        cache.cacheData(parserCacheKey, await load(parserBytes));
        return cache.getCachedData(parserCacheKey);
    } else return cache.getCachedData(parserCacheKey);
};

const getParsed = async(plugin: string) => {
    if (!cache.exists(`${plugin}-parsed`)) {
        const pBytes: Uint8Array = await pluginBytes(plugin); //Await?
        try {
            cache.cacheData(`${plugin}-parsed`, await (await componentParser()).parse("component", pBytes));
            if (cache.getCachedData(`${plugin}-parsed`).exportedFuncs === undefined)
            {
                throw new InvalidPlugin(`${serviceName}:${plugin} does not export any functions.`);
            }
        } catch(e) {
            throw new ParsingFailed(`${serviceName}:${plugin} was able to be loaded but not parsed`);
        }
        cache.getCachedData(`${plugin}-parsed`);
    } else {
        return cache.getCachedData(`${plugin}-parsed`);
    }
}

const pluginBytes = async (plugin: string): Promise<Uint8Array> => {
    if (!cache.exists(plugin)) {
        try {
            cache.cacheData(plugin, await wasmUrlToIntArray(`/${plugin}.wasm`));
        } catch (e) {
            if (e instanceof DownloadFailed)
                throw new PluginDownloadFailed({service: serviceName, plugin})
        }
        await getParsed(plugin);
        return cache.getCachedData(plugin);
    } else {
        return cache.getCachedData(plugin);
    }
};

interface StaticImportFills {
    callerService: string | null;
    callerOrigin: string;
    myOrigin: string;
    myService: string;
}

const initStaticImports = (staticImports: string, importFills: StaticImportFills) => {
    let {callerService, callerOrigin, myOrigin, myService} = importFills;
    return staticImports
        .replace(
            'let callerService = UNINITIALIZED;',
            `let callerService = ${callerService === null? "null" : JSON.stringify(callerService)};`
        )
        .replace(
            'let callerOrigin = UNINITIALIZED;',
            `let callerOrigin = "${callerOrigin}";`
        )
        .replace(
            'let myService = UNINITIALIZED;',
            `let myService = "${myService}";`
        )
        .replace(
            'let myOrigin = UNINITIALIZED;',
            `let myOrigin = "${myOrigin}";`
        );
        
};

const getServiceName = () => {
    const currentUrl = new URL(window.location.href);
    const hostnameParts = currentUrl.hostname.split(".");
    let serviceName = hostnameParts.shift();
    return serviceName !== undefined ? serviceName : "";
};

const serviceName: string = getServiceName();

const hasTargetFunc = (
    exportedFuncs: any,
    intf: string | undefined,
    method: string
) => {
    const found =
        intf !== undefined
            ? exportedFuncs.interfaces
                  .find((i: any) => {
                      return i.name === intf;
                  })
                  ?.funcs.find((f: any) => {
                      return f === method;
                  })
            : exportedFuncs.funcs.find((f: any) => {
                  return f === method;
              });
    return found !== undefined;
};

const extractService = (callerOrigin: string, myOrigin: string): string | null => {
    const extractRootDomain = (origin: string): string => {
        const url = new URL(origin);
        const parts = url.hostname.split('.');
        parts.shift();
        return `${parts.join('.')}${url.port ? ':' + url.port : ''}`;
    };

    const callerRoot = extractRootDomain(callerOrigin);
    const myRoot = extractRootDomain(myOrigin);

    return callerRoot === myRoot ? new URL(callerOrigin).hostname.split('.')[0] : null;
};

const cache = new CallCache();

let activeArgs: QualifiedFunctionCallArgs;

const onPluginCallRequest = async ({
    caller,
    args,
    resultCache
}: PluginCallPayload) => {
    activeArgs = args;
    let { service, plugin, intf, method } = args;

    // Early terminate if this is the wrong loader to handle the request
    if (service != serviceName) {
        throw Error(`${serviceName} received a call meant for ${service}`);
    }

    const pBytes = await pluginBytes(plugin);
    let parsed = await getParsed(plugin);
    // Early terminate if the function being called is not exported by the plugin.
    if (!hasTargetFunc(parsed.exportedFuncs, intf, method)) {
        throw Error(`${toString(args)}: Named function is not an export.`);
    }

    let importFills: StaticImportFills = {
        callerService: extractService(caller, window.origin),
        callerOrigin: caller,
        myService: serviceName,
        myOrigin: `${window.origin}`,
    };
    let importables: Importables[] = [
        { [`common:plugin/*`]: initStaticImports(importableCode, importFills)},
        ...getImportFills(parsed.importedFuncs, resultCache)
    ];

    // TODO: Once we replace instead of using the rollup plugin, we can have a much better
    //   caching strategy. Transpilation only needs to happen once.
    // @ts-ignore
    const pluginModule = await load(pBytes, importables);

    let func =
        typeof args.intf === "undefined" || args.intf === ""
            ? pluginModule[args.method]
            : pluginModule[args.intf][args.method];
    const res = func(...args.params);

    window.parent.postMessage(
        buildPluginCallResponse(res),
        siblingUrl(null, "supervisor-sys")
    );
};

const isMessageFromSupervisor = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSupervisorDomain = message.origin == supervisorDomain;
    return !isTop && isParent && isSupervisorDomain;
};

const onRawEvent = async (message: MessageEvent) => {
    if (!isMessageFromSupervisor(message)) {
        console.warn("Loader recieved a postmessage from an unknown origin.");
        return;
    }
    if (isPreloadStartMessage(message.data)) {
        try {
            onPreloadStart(message.data);
        } catch (e: unknown) {
            console.error(`Preload failed with: ${JSON.stringify(e, null, 2)}`);
        }
    } else if (isPluginCallRequest(message.data)) {
        try {
            await onPluginCallRequest(message.data.payload);
        } catch (e: unknown) {
            handleErrors(activeArgs, e);
        }
    }
};

const onPreloadStart = async (message: LoaderPreloadStart) => {
    const { plugins } = message.payload;
        for (const p of plugins) {
            try {
                await pluginBytes(p);
            }
            catch (e) {
                console.error(`Preload failed: ${serviceName}:${p}\nError: ${JSON.stringify(e, null, 2)}`);
            }
            cache.getCachedData(`${p}-parsed`);
        }

    // TODO: add dependencies to preloadComplete so they can be loaded
    window.parent.postMessage(
        buildPreloadCompleteMessage([]),
        siblingUrl(null, "supervisor-sys")
    );
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), supervisorDomain);

/* On Caching the static imports
These could be cached and then cleared on each non-sync call. Non-sync calls signify completion, 
    and therefore this cache item should be deleted on completion so it gets recreated for the 
    next invocation (which will presumably have a new caller, etc.).
However, if there is an external error and we aren't notified, it could cause us to leave stale
    static imports cached, which could be a security risk (Evaluating requests for action as 
    though they are from a sender with higher permissions than the actual sender, for example). For 
    this reason, and because caching static imports is likely low impact, it is better to simply 
    rebuild them on every re-entry for now.
*/
