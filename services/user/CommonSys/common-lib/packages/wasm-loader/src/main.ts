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
    // buildPluginCallResponse,
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

// @ts-ignore
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

    console.log(parsedFunctions, "are the parsed functions..", {
        id,
        args,
        precomputedResults
    });

    const fulfilledFunctions = precomputedResults.map((func) =>
        generateFulfilledFunction(func.method, func.result)
    );

    const missingFunctions = Object.entries(parsedFunctions).map(
        ([service, methods]) => [
            service,
            methods.filter(
                (method) =>
                    !precomputedResults.some(
                        (result) =>
                            result.method == method && result.service == service
                    )
            )
        ]
    );

    console.log({ missingFunctions, fulfilledFunctions, parsedFunctions });

    const str =
        importableCode +
        `\n ${missingFunctions
            .map((missingFunction) =>
                generatePendingFunction(missingFunction, id)
            )
            .join("\n")} \n ${fulfilledFunctions}`;

    console.log(str, "is the str", args.service);

    const baseImports = "";
    // utilise an object to create the rest,
    // take the object, and return an array to spread

    const serviceImports = serviceMethodIndexToImportables(
        parsedFunctions,
        args.service,
        id
    );

    // we want to achieve /imports for
    let importables: Importables[] = [
        {
            [`component:${args.service}/imports`]: str
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
        console.log(res, "from runWASM!");
        sendPluginCallResponse(buildPluginCallResponse(id, res));
    } catch (e) {
        console.warn(`runWasm threw.`, e);
    }
};

// @ts-ignore
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

const serviceMethodIndexToImportables = (
    serviceMethodIndex: ServiceMethodIndex,
    service: string,
    id: string
): { [key: string]: string }[] => {
    return Object.entries(serviceMethodIndex).map(([key, functions]) => {
        return {
            [`component:${service}}/${key}`]: functions
                .map(
                    (func) =>
                        generatePendingFunction(
                            { method: func, service: key },
                            id
                        ) + "\n"
                )
                .join("\n")
        };
    });
};

const onRawEvent = (message: MessageEvent) => {
    if (isPluginCallRequest(message.data)) {
        onPluginCallRequest(message.data);
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), "*");
