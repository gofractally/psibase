import { buildMessageLoaderInitialized } from "../../../../common/messaging/supervisor/LoaderInitialized";
import { $init, provider } from "./component_parser";
import {
    generateFulfilledFunction,
    generatePendingFunction
} from "./dynamicFunctions";
import importableCode from "./importables.js?raw";
import {
    PluginCallResponse,
    isPluginCallRequest,
    PluginCallRequest,
    PluginCallPayload,
    buildPluginCallResponse
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
        const res = await runWasm(
            wasmBytes,
            importables,
            args.method,
            args.params
        );
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

const stripGenerated = (lines: string[]) => {
    let startingIndex = -1;
    let endingIndex = -1;

    lines.forEach((line, index) => {
        if (line.startsWith("package component:")) {
            startingIndex = index;
        } else {
            if (startingIndex != -1 && endingIndex == -1) {
                if (line.startsWith("package ")) {
                    endingIndex = index;
                }
            }
        }
    });
    return lines.slice(startingIndex, endingIndex);
};

const groupInterfaces = (lines: string[]) => {
    let obj: { [key: string]: string[] } = {};
    let isOpen = false;
    let currentName = "";
    lines.forEach((line) => {
        if (line.startsWith("interface ")) {
            isOpen = true;
            currentName = line.split(" ")[1];
        } else if (line == "}") {
            isOpen = false;
        } else if (isOpen) {
            obj[currentName] = obj[currentName]
                ? [...obj[currentName], line]
                : [line];
        }
    });

    return obj;
};

type ServiceMethodIndex = {
    [k: string]: string[];
};
const parseFunctions = (data: string): ServiceMethodIndex => {
    const lines = data.split("\n").map((x) => x.trim());
    const newLines = stripGenerated(lines);

    const interfaces = groupInterfaces(newLines);
    const entries = Object.fromEntries(
        Object.entries(interfaces).map(([key, value]): [string, string[]] => [
            key,
            value.map((v) => v.split(" ")[0].slice(0, -1))
        ])
    );

    console.log({ interfaces, entries });

    return entries;
};

interface FunctionResult<T = any> {
    method: string;
    result: T;
}

const serviceMethodIndexToImportables = (
    serviceMethodIndex: ServiceMethodIndex,
    service: string,
    id: string,
    functionsResult: FunctionResult[]
): { [key: string]: string }[] =>
    Object.entries(serviceMethodIndex).map(([key, methodNames]) => ({
        [`component:${service}/${key}`]: methodNames
            .map((methodName) => {
                const functionResult = functionsResult.find(
                    (funcResult) => funcResult.method == methodName
                );
                return (
                    (functionResult
                        ? generateFulfilledFunction(
                              functionResult.method,
                              functionResult.result
                          )
                        : generatePendingFunction(
                              { method: methodName, service: key },
                              id
                          )) + "\n"
                );
            })
            .join("\n")
    }));

const onRawEvent = (message: MessageEvent) => {
    if (isPluginCallRequest(message.data)) {
        onPluginCallRequest(message.data);
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), "*");
