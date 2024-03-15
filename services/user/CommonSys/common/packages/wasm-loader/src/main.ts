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

interface Importables {
    [key: string]: string;
}

const wasmUrlToIntArray = (url: string) =>
    fetch(url)
        .then((res) => res.arrayBuffer())
        .then((buffer) => new Uint8Array(buffer));

// TODO - Add caller app to the arguments passed to the functionCall
const onPluginCallRequest = async ({
    id,
    args,
    precomputedResults
}: PluginCallPayload) => {

    // TODO - Check args.service = this service

    const [pluginBytes, parserBytes, { load }] = await Promise.all([
        wasmUrlToIntArray(`/${args.plugin}.wasm`),
        wasmUrlToIntArray("/common/component_parser.wasm"),
        import("rollup-plugin-wit-component")
    ]);

    const parser = await load(parserBytes);
    const parsed = parser.intf.parse("component", pluginBytes);

    // TODO - Early terminate with helpful error if the function being called 
    //        is not exported by the plugin.

    let importables: Importables[] = adaptImports(parsed.importedFuncs, id, precomputedResults);

    try {
        // @ts-ignore
        const pluginModule = await load(pluginBytes, importables);
        let func = (typeof args.intf === 'undefined' || args.intf === "") ? pluginModule[args.method] 
            : pluginModule[args.intf][args.method];
        const res = func(...args.params);
        console.log(`Plugin call ${args.service} Success: ${res}`);
        sendPluginCallResponse(buildPluginCallResponse(id, res));
    } catch (e) {
        if (e instanceof Error && typeof e.message === 'string' && e.message.includes("synchronous_call")) {
            let contents = JSON.parse(e.message);
            window.parent.postMessage({ type: 'PLUGIN_CALL_FAILURE', payload: contents.target }, siblingUrl(null, "supervisor-sys"));
          } else {
            console.warn(`${args.service} plugin call failed with: ${e}`);
          }
    }
};


const supervisorDomain = siblingUrl(null, "supervisor-sys");


const sendPluginCallResponse = (response: PluginCallResponse) => {
    window.parent.postMessage(response, supervisorDomain);
};    


const isMessageFromSupervisor = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSupervisorDomain = message.origin == supervisorDomain;
    return !isTop && isParent && isSupervisorDomain;
};

const onRawEvent = (message: MessageEvent) => {
    if (isMessageFromSupervisor(message) && isPluginCallRequest(message.data)) {
        onPluginCallRequest(message.data.payload);
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), supervisorDomain);