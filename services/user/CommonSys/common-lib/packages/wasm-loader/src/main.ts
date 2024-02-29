import { buildMessageLoaderInitialized } from "../../../../common/messaging/supervisor/LoaderInitialized";
import { serviceMethodIndexToImportables } from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import {
    PluginCallResponse,
    isPluginCallRequest,
    PluginCallRequest,
    PluginCallPayload,
    buildPluginCallResponse
} from "@messaging";
import { parseFunctions } from "./witParsing";

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

const functionCall = async ({
    id,
    args,
    precomputedResults
}: PluginCallPayload) => {
    const [pluginBytes, parserBytes, wasmComponent] = await Promise.all([
        wasmUrlToIntArray("/plugin.wasm"),
        wasmUrlToIntArray("/common/wasm-loader/component_parser.wasm"),
        import("rollup-plugin-wit-component")
    ]);

    const { provider } = await wasmComponent.load(parserBytes);
    const ComponentParser = new provider.ComponentParser();
    const { wit } = ComponentParser.parse("hello", pluginBytes);
    const parsedFunctions = parseFunctions(wit);

    const serviceImports = serviceMethodIndexToImportables(
        parsedFunctions,
        args.service,
        id,
        precomputedResults.map((res) => ({
            method: res.method,
            result: res.result
        }))
    );

    let importables: Importables[] = [
        {
            [`component:${args.service}/imports`]: importableCode
        },
        ...serviceImports
    ];

    try {
        // @ts-ignore
        const pluginModule = await wasmComponent.load(pluginBytes, importables);
        const res = pluginModule[args.method](...args.params);
        console.log(`Plugin call ${args.service} Success: ${res}`);
        sendPluginCallResponse(buildPluginCallResponse(id, res));
    } catch (e) {
        console.warn(`Plugin call ${args.service} Failure: ${e}`);
        // TODO Do not assume error is only caused from lack of fulfilled function
    }
};

const sendPluginCallResponse = (response: PluginCallResponse) => {
    window.parent.postMessage(response, "*");
};

const onPluginCallRequest = (request: PluginCallRequest) =>
    functionCall(request.payload);

const onRawEvent = (message: MessageEvent) => {
    if (isPluginCallRequest(message.data)) {
        onPluginCallRequest(message.data);
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), "*");
