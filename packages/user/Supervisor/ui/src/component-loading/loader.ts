import { GenerateOptions, generate } from "@bytecodealliance/jco/component";

import { kebabToCamel, kebabToPascal } from "../case.js";
import { HostInterface } from "../host-interface.js";
import { assert } from "../utils.js";
import { ComponentAPI, Functions, Interface } from "../wit-extraction.js";

type PluginImports = Record<string, Record<string, unknown>>;

// The preview2-shim type definitions use `export type *` which are type-only.
// The runtime modules have the actual values, so we import as `any`.
const shimModules: Record<string, any> = {};

async function loadShims(): Promise<void> {
    const [cli, clocks, filesystem, io, random] = await Promise.all([
        import("@bytecodealliance/preview2-shim/cli"),
        import("@bytecodealliance/preview2-shim/clocks"),
        import("@bytecodealliance/preview2-shim/filesystem"),
        import("@bytecodealliance/preview2-shim/io"),
        import("@bytecodealliance/preview2-shim/random"),
    ]);
    Object.assign(shimModules, { cli, clocks, filesystem, io, random });
}

const shimsReady = loadShims();

// Whitelisted WASI imports. Each entry maps a WIT interface to its shim object.
// As we discover that plugins need additional WASI imports, we can add them,
// but each added shim should be validated.
function getWasiImports(): PluginImports {
    const { cli, clocks, filesystem, io, random } = shimModules;
    return {
        "wasi:cli/environment": cli.environment,
        "wasi:cli/exit": cli.exit,
        "wasi:cli/stderr": cli.stderr,
        "wasi:cli/stdin": cli.stdin,
        "wasi:cli/stdout": cli.stdout,
        "wasi:clocks/wall-clock": clocks.wallClock,
        "wasi:clocks/monotonic-clock": clocks.monotonicClock,
        "wasi:filesystem/types": filesystem.types,
        "wasi:filesystem/preopens": filesystem.preopens,
        "wasi:io/error": io.error,
        "wasi:io/streams": io.streams,
        "wasi:random/random": random.random,
    };
}

function buildProxiedImports(
    { interfaces: allInterfaces, funcs: freeFunctions }: Functions,
    host: HostInterface,
): PluginImports {
    assert(
        freeFunctions.length === 0,
        `TODO: Plugins may not import freestanding functions.`,
    );

    const imports: PluginImports = {};
    for (const intf of allInterfaces) {
        if (intf.namespace === "wasi" || intf.namespace === "supervisor")
            continue;

        const key = `${intf.namespace}:${intf.package}/${intf.name}`;

        if (intf.funcs.length === 0) {
            imports[key] = {};
        } else {
            imports[key] = buildInterfaceProxy(intf, host);
        }
    }
    return imports;
}

function buildInterfaceProxy(
    intf: Interface,
    host: HostInterface,
): Record<string, unknown> {
    const proxy: Record<string, unknown> = {};
    for (const func of intf.funcs) {
        if (isResourceMethod(func.name)) {
            addResourceProxy(proxy, intf, func.name, func.dynamicLink, host);
        } else if (func.dynamicLink) {
            proxy[kebabToCamel(func.name)] = (
                pluginRef: { handle: number },
                ...args: unknown[]
            ) =>
                host.syncCallDyn({
                    handle: pluginRef.handle,
                    method: func.name,
                    params: args,
                });
        } else {
            proxy[kebabToCamel(func.name)] = (...args: unknown[]) =>
                host.syncCall({
                    service: intf.namespace,
                    plugin: intf.package,
                    intf: intf.name,
                    method: func.name,
                    params: args,
                });
        }
    }
    return proxy;
}

function isResourceMethod(name: string): boolean {
    return (
        name.includes("[constructor]") ||
        name.includes("[method]") ||
        name.includes("[static]")
    );
}

function addResourceProxy(
    proxy: Record<string, unknown>,
    intf: Interface,
    funcName: string,
    isDynamic: boolean,
    host: HostInterface,
): void {
    if (isDynamic) {
        throw new Error(`Dynamic resource methods are not supported`);
    }

    const bracketIndex = funcName.indexOf("]");
    const dotIndex = funcName.indexOf(".", bracketIndex);
    const rawResourceName =
        dotIndex !== -1
            ? funcName.substring(bracketIndex + 1, dotIndex)
            : funcName.substring(bracketIndex + 1);

    // The component parser returns raw WIT kebab-case names; jco expects the
    //   resource class in PascalCase and methods in camelCase as JS identifiers.
    const className = kebabToPascal(rawResourceName);

    let resourceClass = proxy[className] as any;
    if (!resourceClass) {
        resourceClass = class {
            handle: number | undefined;
        };
        proxy[className] = resourceClass;
    }

    let rawMethodName: string;
    if (funcName.includes("[constructor]")) {
        rawMethodName = "constructor";
    } else if (funcName.includes("[method]") || funcName.includes("[static]")) {
        rawMethodName = funcName.split("]")[1].split(".")[1];
    } else {
        throw new Error(`Invalid resource method name: ${funcName}`);
    }
    const jsMethodName = kebabToCamel(rawMethodName);

    const callResource = (handle: number | undefined, ...args: unknown[]) =>
        host.syncCallResource({
            service: intf.namespace,
            plugin: intf.package,
            intf: intf.name,
            type: rawResourceName,
            handle,
            method: rawMethodName,
            params: args,
        });

    if (rawMethodName === "constructor") {
        const origProto = resourceClass.prototype;
        const newClass = class {
            handle: number | undefined;
            constructor(...args: unknown[]) {
                this.handle = callResource(undefined, ...args) as number;
            }
        };

        // WIT does not mandate that the constructor appears before static methods in the
        //   source, so a static method may already be attached to the placeholder class
        Object.assign(newClass, resourceClass);
        Object.assign(newClass.prototype, origProto);
        proxy[className] = newClass;
    } else if (funcName.includes("[static]")) {
        resourceClass[jsMethodName] = (...args: unknown[]) =>
            callResource(undefined, ...args);
    } else {
        resourceClass.prototype[jsMethodName] = function (
            this: { handle: number | undefined },
            ...args: unknown[]
        ) {
            return callResource(this.handle, ...args);
        };
    }
}

export interface InstantiateResult {
    exports: Record<string, unknown>;
}

export interface CompiledPlugin {
    instantiate: () => Promise<InstantiateResult>;
}

// Transpile a WASM component via jco and pre-compile all core modules.
// Returns a handle whose instantiate() allocates Memory and produces exports.
async function compileWasmComponent(
    wasmBytes: Uint8Array,
    imports: PluginImports,
    debugFileName: string,
): Promise<CompiledPlugin> {
    const name = "component";
    const opts: GenerateOptions = {
        name,
        noTypescript: true,
        instantiation: { tag: "async" },
        noNodejsCompat: true,
        tlaCompat: false,
        validLiftingOptimization: false,
        noNamespacedExports: true,
        tracing: false,
    };

    const { files: transpiledFiles } = await generate(wasmBytes, opts);

    const coreWasmFiles: Array<[string, Uint8Array]> = [];
    let jsSource: string | null = null;

    for (const [fileName, content] of transpiledFiles) {
        if (fileName.endsWith(".wasm")) {
            coreWasmFiles.push([fileName, content]);
        } else if (fileName.endsWith(".js")) {
            jsSource = new TextDecoder().decode(content);
        }
    }

    assert(jsSource !== null, "jco generate produced no JS file");

    // If a future jco version (or some adversarial input) ever caused it to emit a
    //   static `import`/`export ... from`, the browser would silently fetch it.
    //
    // Refuse to load anything we don't recognize.
    const staticImportRegex =
        /^[ \t]*(?:import\s+(?:['"]|[\w*${}\s,]+from\s+['"])|export\s+(?:\*|[\w*${}\s,]+)\s+from\s+['"])/m;
    if (staticImportRegex.test(jsSource)) {
        throw new Error(
            `Refusing to load ${debugFileName}: jco-generated JS contains unexpected module-level import/export-from statements`,
        );
    }

    // Pre-compile all core modules (cheap — no Memory allocated)
    const compiledModules = new Map<string, WebAssembly.Module>();
    await Promise.all(
        coreWasmFiles.map(async ([fileName, bytes]) => {
            const buffer = bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            compiledModules.set(fileName, await WebAssembly.compile(buffer));
        }),
    );

    const getCoreModule = async (path: string): Promise<WebAssembly.Module> => {
        const mod = compiledModules.get(path);
        if (!mod) throw new Error(`Core module not found: ${path}`);
        return mod;
    };

    // Import the jco-generated JS module via blob URL
    const namedSource = `${jsSource}\n//# sourceURL=${debugFileName}`;
    const blob = new Blob([namedSource], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const jcoModule = await import(url);
    URL.revokeObjectURL(url);

    return {
        instantiate: async () => ({
            exports: await jcoModule.instantiate(getCoreModule, imports),
        }),
    };
}

function assertSupervisorImportsSatisfied(
    service: string,
    privileged: boolean,
    importedFuncs: Functions,
    imports: PluginImports,
): void {
    for (const intf of importedFuncs.interfaces) {
        if (intf.namespace !== "supervisor") continue;

        if (intf.funcs.length === 0) continue;

        const key = `${intf.namespace}:${intf.package}/${intf.name}`;

        if (!privileged) {
            throw new Error(
                `Plugin ${service} imports ${key} but is not privileged`,
            );
        }

        const provided = imports[key];
        if (!provided) {
            throw new Error(
                `Plugin ${service} imports ${key}, but the host does not provide it`,
            );
        }

        for (const func of intf.funcs) {
            if (isResourceMethod(func.name)) continue;
            const jsName = kebabToCamel(func.name);
            if (typeof provided[jsName] !== "function") {
                throw new Error(
                    `Plugin ${service} imports ${key}.${func.name}, but the host does not provide it`,
                );
            }
        }
    }
}

export async function compilePlugin(
    service: string,
    privileged: boolean,
    wasmBytes: Uint8Array,
    pluginHost: HostInterface,
    api: ComponentAPI,
): Promise<CompiledPlugin> {
    await shimsReady;
    const imports: PluginImports = {
        ...getWasiImports(),
        ...(privileged ? pluginHost.bridge : {}),
        ...buildProxiedImports(api.importedFuncs, pluginHost),
    };
    assertSupervisorImportsSatisfied(
        service,
        privileged,
        api.importedFuncs,
        imports,
    );
    return compileWasmComponent(wasmBytes, imports, `${service}.plugin.js`);
}

// Loads a utility WASM component (not a plugin) with only WASI imports.
// Compiles and immediately instantiates since utilities like the parser
// are always needed.
export async function loadBasic(
    wasmBytes: Uint8Array,
    debugFileName: string,
): Promise<InstantiateResult> {
    await shimsReady;
    const compiled = await compileWasmComponent(
        wasmBytes,
        getWasiImports(),
        debugFileName,
    );
    return compiled.instantiate();
}
