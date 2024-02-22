import { buildMessageLoaderInitialized } from "../../../../common/messaging/supervisor/LoaderInitialized";
import { $init, provider } from "./component_parser";
import {
    Func,
    generateFulfilledFunction,
    generatePendingFunction
} from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import {
    PluginCallResponse,
    isPluginCallRequest,
    PluginCallRequest,
    buildPluginCallResponse,
    PluginCallPayload
} from "@messaging";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>Loader</h1>
    <p>This is a generated SPA designed to act as the loader, its sole purpose is to be rendered in an iframe and run a WASM Component, then execute functions in the WASM component and send the results back to its parent iframe.</p>
  </div>
`;

interface Importables {
    [key: string]: string;
}

const runWasm = async (
    wasm: ArrayBuffer,
    importables: Importables[],
    method: string,
    params: any[]
) => {
    console.info("runWasm().top 2");
    const { load } = await import("rollup-plugin-wit-component");

    console.time("Load");
    const mod = await load(
        // @ts-expect-error fff
        wasm,
        importables
    );
    console.timeEnd("Load");

    return mod[method](...params);
};

const functionCall = async ({
    id,
    args,
    precomputedResults
}: PluginCallPayload) => {
    const url = "/plugin.wasm";

    const [wasmBytes] = await Promise.all([
        fetch(url).then((res) => res.arrayBuffer()),
        $init
    ]);
    const bytes = new Uint8Array(wasmBytes);

    const ComponentParser = new provider.ComponentParser();

    const { wit } = ComponentParser.parse("hello", bytes);
    const parsedFunctions = parseFunctions(wit);

    const importedFunctionsFromWit: Func[] = parsedFunctions.map((x) => ({
        method: x.functionName,
        service: args.service
    }));

    const fulfilledFunctions = precomputedResults.map((func) =>
        generateFulfilledFunction(func.method, func.result)
    );
    const missingFunctions = importedFunctionsFromWit.filter(
        (func) =>
            !precomputedResults.some(
                (f) => f.method == func.method && f.service == func.service
            )
    );

    const str =
        importableCode +
        `\n ${missingFunctions.map((missingFunction) =>
            generatePendingFunction(missingFunction, id)
        )} \n ${fulfilledFunctions}`;

    let importables: Importables[] = [
        {
            [`component:${args.service}/imports`]: str
        }
    ];

    try {
        const res = await runWasm(
            wasmBytes,
            importables,
            args.method,
            args.params
        );
        sendPluginCallResponse(buildPluginCallResponse(id, res));
    } catch (e) {
        console.warn(`runWasm threw.`);
    }
};

const sendPluginCallResponse = (response: PluginCallResponse) => {
    window.parent.postMessage(response, "*");
};

const onPluginCallRequest = (request: PluginCallRequest) =>
    functionCall(request.payload);

// let ranOnce = false;

interface ParsedFunction {
    packageName: string;
    functionName: string;
    parameters: { name: string; type: string }[];
}

const parseFunctions = (data: string): ParsedFunction[] => {
    const parsedFunctions: ParsedFunction[] = [];
    const functionRegex = /export (\w+): func\(([^)]*)\) -> (\w+);/g;
    let match;

    while ((match = functionRegex.exec(data)) !== null) {
        const [, functionName, parameters, packageName] = match;
        const parameterArray = parameters
            .split(",")
            .map((param) => param.trim())
            .map((paramAndType) => {
                const [name, type] = paramAndType
                    .split(":")
                    .map((x) => x.trim());
                return { name, type };
            });
        parsedFunctions.push({
            packageName,
            functionName,
            parameters: parameterArray
        });
    }

    return parsedFunctions;
};

const onRawEvent = (message: MessageEvent) => {
    if (isPluginCallRequest(message.data)) {
        onPluginCallRequest(message.data);
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), "*");
