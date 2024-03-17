import { adaptImports } from "./dynamicFunctions";
//import importableCode from "./importables.js?raw";
import {
    PluginCallResponse,
    isPluginCallRequest,
    PluginCallPayload,
    buildPluginCallResponse,
    buildMessageLoaderInitialized
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib";

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


const getServiceName = () => {
    const currentUrl = new URL(window.location.href);
    const hostnameParts = currentUrl.hostname.split(".");
    let serviceName = hostnameParts.shift();
    return serviceName !== undefined ? serviceName : "";
};

const serviceName: string = getServiceName();

const hasTargetFunc = (exportedFuncs: any, intf: string | undefined, method: string) => {
    return exportedFuncs.some((f: any)=>{return f.intf === intf && f.funcName === method;});
}

// TODO - Add caller app to the arguments passed to the functionCall
const onPluginCallRequest = async ({
    id,
    args,
    precomputedResults
}: PluginCallPayload) => {

    console.log(`Loader @${serviceName} received a call for ${args.plugin}/${args.intf}->${args.method}`);

    // Early terminate if this is the wrong loader to handle the request
    if (args.service != serviceName) {
        throw Error(`${serviceName} received a call meant for ${args.service}`);
    }

    // Todo - cache these in sessionstorage, or perhaps localstorage?
    const [pluginBytes, parserBytes, { load }] = await Promise.all([
        wasmUrlToIntArray(`/${args.plugin}.wasm`),
        wasmUrlToIntArray("/common/component_parser.wasm"),
        // Todo - use custom transpiler so we can customize options, cache shims, etc.
        import("rollup-plugin-wit-component")
    ]);

    const parsed = (await load(parserBytes)).parse("component", pluginBytes);

    // Early terminate if the function being called is not exported by the plugin.
    if (!hasTargetFunc(parsed.exportedFuncs, args.intf, args.method)) {
        // Todo - replace "Caller" with ${caller}
        const fid: string = (args.intf === undefined) ? `${args.method}` : `${args.method} in ${args.intf}`;
        throw Error(`Caller->${args.service}:${args.plugin} error: No export named ${fid}`);
    }

    let importables: Importables[] = adaptImports(parsed.importedFuncs, id, precomputedResults);

    // @ts-ignore
    const pluginModule = await load(pluginBytes, importables);
    let func =
        typeof args.intf === "undefined" || args.intf === ""
            ? pluginModule[args.method]
            : pluginModule[args.intf][args.method];
    const res = func(...args.params);
    sendPluginCallResponse(buildPluginCallResponse(id, res));
};

const sendPluginCallResponse = (response: PluginCallResponse) => {
    window.parent.postMessage(response, supervisorDomain);
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
    if (isPluginCallRequest(message.data)) {
        try {
            await onPluginCallRequest(message.data.payload);
        } catch (e) {
            if (
                e instanceof Error &&
                typeof e.message === "string" &&
                e.message.includes("synchronous_call")
            ) {
                let contents = JSON.parse(e.message);
                window.parent.postMessage(
                    { type: "PLUGIN_CALL_FAILURE", payload: contents.target },
                    supervisorDomain
                );
            } else {
                // This should just forward the error to the supervisor for triage.
                console.warn(
                    `${message.data.payload.args.service} plugin call failed with: ${e}`
                );
            }
        }
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), supervisorDomain);
