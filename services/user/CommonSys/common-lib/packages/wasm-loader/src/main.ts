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
    console.log(wit, "is the wit");

    console.log(JSON.stringify(wit), "is the raw");
    const parsedFunctions = parseFunctions(wit);

    console.log(parsedFunctions, "are the parsed functions..");

    const fulfilledFunctions = precomputedResults.map((func) =>
        generateFulfilledFunction(func.method, func.result)
    );
    const missingFunctions = parsedFunctions
        .filter(
            (func) =>
                !precomputedResults.some(
                    (f) => f.method == func.method && f.service == func.service
                )
        )
        .filter((x) => x.service !== "imports");

    console.log({ missingFunctions, fulfilledFunctions, parsedFunctions });

    const str =
        importableCode +
        `\n ${missingFunctions
            .map((missingFunction) =>
                generatePendingFunction(missingFunction, id)
            )
            .join("\n")} \n ${fulfilledFunctions}`;

    console.log(str, "is the str", args.service);
    let importables: Importables[] = [
        {
            [`component:${args.service}/imports`]: str
        },
        ...(args.service == "demoapp1"
            ? [
                  {
                      [`component:demoapp1/demoapp2`]: str
                  }
              ]
            : [])
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

const parseFunctions = (data: string): Func[] => {
    const lines = data.split("\n").map((x) => x.trim());
    const newLines = stripGenerated(lines);

    const interfaces = groupInterfaces(newLines);
    const entries = Object.entries(interfaces)
        .map(([key, value]): [string, string[]] => [
            key,
            value.map((v) => v.split(" ")[0].slice(0, -1))
        ])
        .flatMap(([key, value]): Func[] =>
            (value as string[]).map((name) => ({ method: name, service: key }))
        );

    console.log({ interfaces, entries });

    return entries;
};

const onRawEvent = (message: MessageEvent) => {
    if (isPluginCallRequest(message.data)) {
        onPluginCallRequest(message.data);
    }
};

window.addEventListener("message", onRawEvent);
window.parent.postMessage(buildMessageLoaderInitialized(), "*");
