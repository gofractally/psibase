import { getImportFills } from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import {
    PluginCallResponse,
    isPluginCallRequest,
    PluginCallPayload,
    buildPluginCallResponse,
    buildMessageLoaderInitialized,
    QualifiedFunctionCallArgs,
    toString
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib";
import { CallCache } from "./callCache";

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
        .then((res) => res.arrayBuffer())
        .then((buffer) => new Uint8Array(buffer));

let callerService = "initialized";
let callerDomain = "initialized";
let myDomain = "initialized";
let myService = "initialized";
const initStaticImports = (staticImports: string) => {
    return staticImports
        .replace(
            'let callerService = "uninitialized";',
            `let callerService = "${callerService}";`
        )
        .replace(
            'let callerDomain = "uninitialized";',
            `let callerDomain = "${callerDomain}";`
        )
        .replace(
            'let myDomain = "uninitialized";',
            `let myDomain = "${myDomain}";`
        )
        .replace(
            'let myService = "uninitialized";',
            `let myService = "${myService}";`
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

const cache = new CallCache();

const retrieveNetworkItems = async (
    args: QualifiedFunctionCallArgs,
    caller: string
) => {
    let { plugin, intf, method, service } = args;
    let [pluginBytes, parserBytes, { load }] = await Promise.all([
        wasmUrlToIntArray(`/${plugin}.wasm`),
        wasmUrlToIntArray("/common/component_parser.wasm"),
        // Todo - use custom transpiler so we can customize options, cache shims, etc.
        import("rollup-plugin-wit-component")
    ]);

    let parsed: any;
    if (cache.exists("parsed")) {
        parsed = cache.getCachedData("parsed");
    } else {
        parsed = (await load(parserBytes)).parse("component", pluginBytes);
        cache.cacheData("parsed", parsed);

        // Early terminate if the function being called is not exported by the plugin.
        if (!hasTargetFunc(parsed.exportedFuncs, intf, method)) {
            const fid: string =
                intf === undefined ? `${method}` : `${method} in ${intf}`;
            throw Error(
                `${caller}->${service}:${plugin} error: No export named ${fid}`
            );
        }
    }

    return {
        plugin: pluginBytes,
        parsed,
        load
    };
};

let activeArgs : QualifiedFunctionCallArgs;

const onPluginCallRequest = async ({
    caller, // TODO: Make sure this caller hostname gets parsed properly into the origination-data object
    args,
    resultCache
}: PluginCallPayload) => {
    activeArgs = args;

    // Early terminate if this is the wrong loader to handle the request
    if (args.service != serviceName) {
        throw Error(`${serviceName} received a call meant for ${args.service}`);
    }

    let { plugin, parsed, load } = await retrieveNetworkItems(args, caller);

    let importables: Importables[] = [
        { [`common:plugin/*`]: initStaticImports(importableCode) },
        ...getImportFills(parsed.importedFuncs, resultCache)
    ];

    // TODO: Once we replace instead of using the rollup plugin, we can have a much better
    //   caching strategy. Transpilation only needs to happen once.
    // @ts-ignore
    const pluginModule = await load(plugin, importables);
    let func =
        typeof args.intf === "undefined" || args.intf === ""
            ? pluginModule[args.method]
            : pluginModule[args.intf][args.method];
    const res = func(...args.params);
    sendPluginCallResponse(buildPluginCallResponse(res));
};

const sendPluginCallResponse = (response: PluginCallResponse) => {
    cache.clearCache();
    window.parent.postMessage(response, supervisorDomain);
};

const isMessageFromSupervisor = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSupervisorDomain = message.origin == supervisorDomain;
    return !isTop && isParent && isSupervisorDomain;
};

interface ComponentError extends Error {
    payload: object;
}

interface CommonPluginId {
    plugin: string;
    service: string;
}
interface CommonError {
    code: number;
    message: string;
    producer: CommonPluginId;
}

function isCommonPluginId(pluginId: any): pluginId is CommonPluginId {
    return (
        typeof pluginId === "object" &&
        "plugin" in pluginId &&
        typeof pluginId.plugin === "string" &&
        "service" in pluginId &&
        typeof pluginId.service === "string"
    );
}

function isCommonError(error: any): error is CommonError {
    return (
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "number" &&
        "message" in error &&
        typeof error.message === "string" &&
        "producer" in error &&
        typeof error.producer === "object" &&
        isCommonPluginId(error.producer)
    );
}

const isSyncCall = (e: any): e is Error => {
    return (
        e instanceof Error &&
        typeof e.message === "string" &&
        e.message.includes("Cannot destructure property")
    );
};

const onRawEvent = async (message: MessageEvent) => {
    if (!isMessageFromSupervisor(message)) {
        console.warn("Loader recieved a postmessage from an unknown origin.");
        return;
    }
    if (isPluginCallRequest(message.data)) {
        try {
            await onPluginCallRequest(message.data.payload);
        } catch (e: unknown) {
            if (isSyncCall(e)) {
                /* Swallow sync call detection */
            } else if (
                e instanceof Error &&
                typeof (e as ComponentError).payload === "object" &&
                isCommonError((e as ComponentError).payload)
            ) {
                let ret = {
                    errorType: "recoverable",
                    val: (e as ComponentError).payload
                };
                sendPluginCallResponse(buildPluginCallResponse(ret));
            } else if (e instanceof Error && e.message === "unreachable") {
                let ret = {
                    errorType: "unrecoverable",
                    val: { message: `${toString(activeArgs)}: Runtime error (panic)` }
                };
                sendPluginCallResponse(buildPluginCallResponse(ret));
            } else if (
                e !== null &&
                typeof e === "object" &&
                "code" in e &&
                typeof e.code === "string" &&
                e.code === "PARSE_ERROR"
            ) {
                let ret = {
                    errorType: "unrecoverable",
                    val: {
                        message: `${toString(activeArgs)}: Possible plugin import code gen error`
                    }
                };
                sendPluginCallResponse(buildPluginCallResponse(ret));
            } else {
                // Unrecognized error
                let ret = {
                    errorType: "unrecoverable",
                    val: { error: e, message: `${toString(activeArgs)}`},
                };
                sendPluginCallResponse(buildPluginCallResponse(ret));
            }
        }
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), supervisorDomain);
