import { GenerateOptions, generate } from "@bytecodealliance/jco/component";
import { rollup, type WarningHandlerWithDefault } from "@rollup/browser";
import { cli, clocks, filesystem, io, random } from '@bytecodealliance/preview2-shim';
import shimCode from './shims/shimWrapper.js?raw';

import { HostInterface } from "../hostInterface.js";
import { assert } from "../utils.js";
import { ComponentAPI, Functions } from "../witExtraction.js";
import { Code, FilePath, ImportDetails, PkgId } from "./importDetails.js";
import { plugin } from "./index.js";
import privilegedShimCode from "./privileged-api.js?raw";
import { ProxyPkg } from "./proxy/proxyPackage.js";

// Set up the global reference for runtime access
(globalThis as Record<string, unknown>).__preview2Shims = { cli, clocks, filesystem, io, random };

class ProxyPkgs {
    packages: ProxyPkg[] = [];

    [Symbol.iterator]() {
        return this.packages.values();
    }

    get = (ns: string, id: string): ProxyPkg => {
        let pkg = this.packages.find((p) => p.namespace === ns && p.id === id);
        if (pkg) {
            return pkg;
        }
        pkg = new ProxyPkg(ns, id);
        this.packages.push(pkg);
        return pkg;
    };

    map<T>(
        callback: (pkg: ProxyPkg, index: number, array: ProxyPkg[]) => T,
    ): T[] {
        return this.packages.map(callback);
    }
}

function getProxiedImports({
    interfaces: allInterfaces,
    funcs: freeFunctions,
}: Functions): ImportDetails {
    assert(
        freeFunctions.length === 0,
        `TODO: Plugins may not import freestanding functions.`,
    );

    const interfaces = allInterfaces.filter(
        (i) =>
            i.namespace !== "wasi" &&
            i.namespace !== "supervisor" &&
            i.funcs.length !== 0,
    );

    if (interfaces.length === 0) {
        return new ImportDetails([], []);
    }

    const packages = new ProxyPkgs();
    for (const i of interfaces) {
        packages.get(i.namespace, i.package).add(i.name, i.funcs);
    }

    const imports: ImportDetails[] = packages.map((p) => p.getImportDetails());
    return mergeImports(imports);
}



async function getWasiImports(): Promise<ImportDetails> {
    /*
      I'm taking a whitelisting approach, as opposed to providing all wasi imports by default.
      As we discover that plugins need additional wasi imports, we can add them, but each added
      shim should be validated.
    */

    const wasi_shimName = "./wasi-shim.js"; // Internal name used by bundler
    const wasi_nameMapping: Array<[PkgId, FilePath]> = [
        // e.g. importing an entire package ["wasi:cli/*", `${wasi_shimName}#*`],

        ["wasi:cli/environment", `${wasi_shimName}#environment`],
        ["wasi:cli/exit", `${wasi_shimName}#exit`],
        ["wasi:io/error", `${wasi_shimName}#error`],
        ["wasi:io/streams", `${wasi_shimName}#streams`],
        ["wasi:cli/stdin", `${wasi_shimName}#stdin`],
        ["wasi:cli/stdout", `${wasi_shimName}#stdout`],
        ["wasi:cli/stderr", `${wasi_shimName}#stderr`],
        ["wasi:clocks/wall-clock", `${wasi_shimName}#wallClock`],
        ["wasi:clocks/monotonic-clock", `${wasi_shimName}#monotonicClock`],
        ["wasi:filesystem/types", `${wasi_shimName}#types`],
        ["wasi:filesystem/preopens", `${wasi_shimName}#preopens`],
        ["wasi:random/random", `${wasi_shimName}#random`],
        // ["wasi:io/*", `${wasi_shimName}#*`],
        // ["wasi:sockets/*", `${wasi_shimName}#*`],

        //  ~~~~~~~~~~~~~~~ BLACKLISTED ~~~~~~~~~~~~~~~
        // ["wasi:http/*", `${wasi_shimName}#*`],
        // We should not provide the http shim.
        // Plugins should not be able to make HTTP requests except those that are wrapped in an
        //   interface provided by the host imports.
    ];
    // If the transpiled library contains bizarre inputs, such as:
    //    import {  as _, } from './shim.js';
    // It is very likely an issue with an invalid import mapping.

    const wasi_shimCode = shimCode;
    const wasi_ShimFile: [FilePath, Code] = [wasi_shimName, wasi_shimCode];
    return {
        importMap: wasi_nameMapping,
        files: [wasi_ShimFile],
    };
}

async function getPrivilegedImports(): Promise<ImportDetails> {
    const privilegedShimName = "./privileged-api.js"; // internal name used by bundler
    const privileged_importMap: Array<[PkgId, FilePath]> = [
        [`supervisor:bridge/*`, `${privilegedShimName}#*`],
    ];
    const privileged_ShimFile: [FilePath, Code] = [
        privilegedShimName,
        privilegedShimCode,
    ];
    return {
        importMap: privileged_importMap,
        files: [privileged_ShimFile],
    };
}

function mergeImports(importDetails: ImportDetails[]): ImportDetails {
    const importMap: Array<[PkgId, FilePath]> = importDetails.flatMap(
        (detail) => detail.importMap,
    );
    const files: Array<[FilePath, Code]> = importDetails.flatMap(
        (detail) => detail.files,
    );
    return new ImportDetails(importMap, files);
}

export async function loadPlugin(
    service: string,
    privileged: boolean,
    wasmBytes: Uint8Array,
    pluginHost: HostInterface,
    api: ComponentAPI,
) {
    const imports = mergeImports(
        await Promise.all([
            getWasiImports(),
            privileged ? getPrivilegedImports() : new ImportDetails([], []),
            getProxiedImports(api.importedFuncs),
        ]),
    );
    const pluginModule = await load(wasmBytes, imports, `${service}.plugin.js`);
    pluginModule.__setHost(pluginHost);

    return pluginModule;
}

// transpile WASM, bundle with shims/imports, and load the module
async function loadWasmComponent(
    wasmBytes: Uint8Array,
    importMap: Array<[PkgId, FilePath]>,
    importFiles: Array<[FilePath, Code]>,
    useSetupFunction: boolean,
    debugFileName: string,
) {
    const name = "component";
    const opts: GenerateOptions = {
        name,
        noTypescript: true,
        map: importMap ?? [],
        base64Cutoff: 4096,
        noNodejsCompat: true,
        tlaCompat: false,
        validLiftingOptimization: false,
        noNamespacedExports: true,
    };

    const { files: transpiledFiles } = await generate(wasmBytes, opts);

    const onwarn: WarningHandlerWithDefault = (warning, warn) => {
        if (warning.code !== "CIRCULAR_DEPENDENCY") {
            warn(warning);
        }
    };

    const bundleCode: string = await rollup({
        input: name + ".js",
        plugins: [
            plugin(
                [...transpiledFiles, ...importFiles],
                useSetupFunction,
                debugFileName,
            ),
        ],
        onwarn,
        treeshake: false,
    })
        .then((bundle) => bundle.generate({ format: "es" }))
        .then(({ output }) => output[0].code);

    const namedBundleCode = `${bundleCode}\n//# sourceURL=${debugFileName}`;
    const blob = new Blob([namedBundleCode], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);

    try {
        const mod = await import(url);
        return mod;
    } finally {
        URL.revokeObjectURL(url); // Lets the browser know not to keep the file ref any longer
    }
}

async function load(
    wasmBytes: Uint8Array,
    imports: ImportDetails,
    debugFileName: string,
) {
    const pluginModule = await loadWasmComponent(
        wasmBytes,
        imports.importMap,
        imports.files,
        true,
        debugFileName,
    );
    return pluginModule;
}

// Loads a transpiled component into an ES module, while only satisfying wasi imports
// Not sufficient for plugins, which require other direct host exports, but can be used
//   to run various other utilities in the browser that have been compiled into wasm
//   components.
export async function loadBasic(wasmBytes: Uint8Array, debugFileName: string) {
    const wasiImports = await getWasiImports();
    const basicModule = await loadWasmComponent(
        wasmBytes,
        wasiImports.importMap,
        wasiImports.files,
        false,
        debugFileName,
    );
    return basicModule;
}
