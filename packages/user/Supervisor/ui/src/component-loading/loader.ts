import { GenerateOptions, generate } from "@bytecodealliance/jco/component";

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

function buildPrivilegedImports(host: HostInterface): PluginImports {
    return {
        "supervisor:bridge/intf": {
            sendRequest: (...args: unknown[]) =>
                host.sendRequest(
                    ...(args as Parameters<HostInterface["sendRequest"]>),
                ),
            serviceStack: () => host.getServiceStack(),
            getRootDomain: () => host.getRootDomain(),
            getChainId: () => host.getChainId(),
            importKey: (privateKey: string) => host.importKey(privateKey),
            signExplicit: (msg: Uint8Array, privateKey: string) =>
                host.signExplicit(msg, privateKey),
            sign: (msg: Uint8Array, publicKey: string) =>
                host.sign(msg, publicKey),
        },
        "supervisor:bridge/database": {
            get: (...args: unknown[]) =>
                host.dbGet(...(args as Parameters<HostInterface["dbGet"]>)),
            set: (...args: unknown[]) =>
                host.dbSet(...(args as Parameters<HostInterface["dbSet"]>)),
            remove: (...args: unknown[]) =>
                host.dbRemove(
                    ...(args as Parameters<HostInterface["dbRemove"]>),
                ),
        },
        "supervisor:bridge/prompt": {
            requestPrompt: () => host.requestPrompt(),
        },
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

        const key = `${intf.namespace}:${toKebabCase(intf.package)}/${toKebabCase(intf.name)}`;

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
            proxy[func.name] = (
                pluginRef: { handle: number },
                ...args: unknown[]
            ) =>
                host.syncCallDyn({
                    handle: pluginRef.handle,
                    method: func.name,
                    params: args,
                });
        } else {
            proxy[func.name] = (...args: unknown[]) =>
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

// The WIT parser returns camelCase names (e.g. "hookHandlers", "wallClock")
// but jco uses the original WIT kebab-case (e.g. "hook-handlers", "wall-clock")
// as import keys. Convert camelCase back to kebab-case.
function toKebabCase(str: string): string {
    return str.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function addResourceProxy(
    proxy: Record<string, unknown>,
    intf: Interface,
    funcName: string,
    _isDynamic: boolean,
    host: HostInterface,
): void {
    const bracketIndex = funcName.indexOf("]");
    const dotIndex = funcName.indexOf(".", bracketIndex);
    const rawResourceName =
        dotIndex !== -1
            ? funcName.substring(bracketIndex + 1, dotIndex)
            : funcName.substring(bracketIndex + 1);

    // jco expects the resource class name in PascalCase. The component parser
    //   already converts kebab-case to camelCase before we see it, so all we
    //   need to do here is capitalize the first letter.
    const className =
        rawResourceName.charAt(0).toUpperCase() + rawResourceName.slice(1);

    let resourceClass = proxy[className] as any;
    if (!resourceClass) {
        resourceClass = class {
            handle: number | undefined;
        };
        proxy[className] = resourceClass;
    }

    let methodName: string;
    if (funcName.includes("[constructor]")) {
        methodName = "constructor";
    } else if (funcName.includes("[method]") || funcName.includes("[static]")) {
        methodName = funcName.split("]")[1].split(".")[1];
    } else {
        throw new Error(`Invalid resource method name: ${funcName}`);
    }

    const callResource = (handle: number | undefined, ...args: unknown[]) =>
        host.syncCallResource({
            service: intf.namespace,
            plugin: intf.package,
            intf: intf.name,
            type: className,
            handle,
            method: methodName,
            params: args,
        });

    if (methodName === "constructor") {
        const origProto = resourceClass.prototype;
        const newClass = class {
            handle: number | undefined;
            constructor(...args: unknown[]) {
                this.handle = callResource(undefined, ...args) as number;
            }
        };
        Object.assign(newClass.prototype, origProto);
        proxy[className] = newClass;
    } else if (funcName.includes("[static]")) {
        resourceClass[methodName] = (...args: unknown[]) =>
            callResource(undefined, ...args);
    } else {
        resourceClass.prototype[methodName] = function (
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
        ...(privileged ? buildPrivilegedImports(pluginHost) : {}),
        ...buildProxiedImports(api.importedFuncs, pluginHost),
    };
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
