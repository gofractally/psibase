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

    console.log(JSON.stringify(wit), "is the raw");
    const parsedFunctions = parseFunctions(wit);

    console.log(parsedFunctions, "are the parsed functions..");
    // const importedFunctionsFromWit: Func[] = parsedFunctions
    //     .filter(
    //         (func) =>
    //             func.packageName == "imports" ||
    //             func.packageName.endsWith("service")
    //     )
    //     .map((x) => ({
    //         method: x.functionName,
    //         service: x.packageName.endsWith("service")
    //             ? x.packageName.slice(0, -7)
    //             : x.packageName
    //     }));
    const importedFunctionsFromWit: Func[] = [
        {
            method: "callintoplugin",
            service: "demoapp2"
        }
    ];
    console.log("are the output", importedFunctionsFromWit);

    const fulfilledFunctions = precomputedResults.map((func) =>
        generateFulfilledFunction(func.method, func.result)
    );
    const missingFunctions = importedFunctionsFromWit
        .filter(
            (func) =>
                !precomputedResults.some(
                    (f) => f.method == func.method && f.service == func.service
                )
        )
        .map((x) => {
            if (x.method == "callintoplugin") {
                return {
                    ...x,
                    service: "demoapp2"
                };
            } else return x;
        });

    const str =
        importableCode +
        `\n ${missingFunctions
            .map((missingFunction) =>
                generatePendingFunction(missingFunction, id)
            )
            .join("\n")} \n ${fulfilledFunctions}`;

    console.log(str, "is the str");
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
        console.log(res, "from runWASM!");
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

interface ParsedFunction {
    packageName: string;
    functionName: string;
    parameters: { name: string; type: string }[];
}
const parseFunctions = (data: string): ParsedFunction[] => {
    console.log({ data });
    const parsedFunctions: ParsedFunction[] = [];
    const lines = data.split("\n");
    console.log({ lines });

    let isInInterface = false;
    let currentInterfaceName = "";

    for (const line of lines) {
        const trimmedLine = line.trim();
        console.log({ trimmedLine });

        if (trimmedLine.startsWith("interface")) {
            isInInterface = true;
            const parts = trimmedLine.split(" ");
            currentInterfaceName = parts[1];
            console.log({ currentInterfaceName, parts });
        } else if (isInInterface && trimmedLine.includes("func")) {
            const parts = trimmedLine.split(":");
            const functionName = parts[0].trim();
            const parameters = parts[1].trim().replace(";", "");

            parsedFunctions.push({
                packageName: currentInterfaceName,
                functionName,
                parameters: parameters.split(",").map((param) => {
                    const [name, type] = param.trim().split(":");
                    return { name, type };
                })
            });
        } else if (isInInterface && trimmedLine === "}") {
            isInInterface = false;
            currentInterfaceName = "";
        }
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
