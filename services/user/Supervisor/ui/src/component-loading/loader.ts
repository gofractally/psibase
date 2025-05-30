import { rollup } from "@rollup/browser";
import { plugin } from "./index.js";

import { HostInterface } from "../hostInterface.js";
import { ComponentAPI, Functions } from "../witExtraction.js";
import { assert } from "../utils.js";
import { ProxyPkg } from "./proxy/proxyPackage.js";
import { Code, FilePath, ImportDetails, PkgId } from "./importDetails.js";
import { generate, GenerateOptions } from "@bytecodealliance/jco/component";

// Raw imports
import hostShimCode from "./host-api.js?raw";
import privilegedShimCode from "./privileged-api.js?raw";

const cliShimCode = require.resolve("@bytecodealliance/preview2-shim/lib/browser/cli.js");
const clocksShimCode = require.resolve("@bytecodealliance/preview2-shim/lib/browser/clocks.js");
const filesystemShimCode = require.resolve("@bytecodealliance/preview2-shim/lib/browser/filesystem.js");
const ioShimCode = require.resolve("@bytecodealliance/preview2-shim/lib/browser/io.js");
const randomShimCode = require.resolve("@bytecodealliance/preview2-shim/lib/browser/random.js");

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
            i.namespace !== "host" &&
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

// These are shims for wasi interfaces that have not yet been standardized
// Since the interface is not standard, the shim is not provided by BCA.
async function getNonstandardWasiImports(): Promise<ImportDetails> {
    const shimName = "./wasi-keyvalue.js";
    const nameMapping: Array<[PkgId, FilePath]> = [
        ["wasi:keyvalue/*", `${shimName}#*`],
    ];
    // If the transpiled library contains bizarre inputs, such as:
    //    import {  as _, } from './shim.js';
    // It is very likely an issue with an invalid import mapping.
    const shimUrl = new URL("./shims/wasi-keyvalue.js", import.meta.url);
    const shimCode = await fetch(shimUrl).then((r) => r.text());
    const shimFile: [FilePath, Code] = [shimName, shimCode];
    return {
        importMap: nameMapping,
        files: [shimFile],
    };
}

async function getWasiImports(): Promise<ImportDetails> {
    /*
      I'm taking a whitelisting approach, as opposed to providing all wasi imports by default.
      As we discover that plugins need additional wasi imports, we can add them, but each added
      shim should be validated.
    */
    const shimPaths = {
        cli: "./cli.js",
        clocks: "./clocks.js",
        filesystem: "./filesystem.js",
        io: "./io.js",
        random: "./random.js",
    };

    // Mapping from WIT identifiers to internal shim paths and the specific export
    const nameMapping: Array<[PkgId, FilePath]> = [
        // CLI
        ["wasi:cli/environment", `${shimPaths.cli}#environment`],
        ["wasi:cli/exit", `${shimPaths.cli}#exit`],
        ["wasi:cli/stdin", `${shimPaths.cli}#stdin`],
        ["wasi:cli/stdout", `${shimPaths.cli}#stdout`],
        ["wasi:cli/stderr", `${shimPaths.cli}#stderr`],
        // Clocks
        ["wasi:clocks/wall-clock", `${shimPaths.clocks}#wallClock`],
        ["wasi:clocks/monotonic-clock", `${shimPaths.clocks}#monotonicClock`],
        // Filesystem
        ["wasi:filesystem/types", `${shimPaths.filesystem}#types`],
        ["wasi:filesystem/preopens", `${shimPaths.filesystem}#preopens`],
        // IO
        ["wasi:io/error", `${shimPaths.io}#error`],
        ["wasi:io/streams", `${shimPaths.io}#streams`],
        // Random
        ["wasi:random/random", `${shimPaths.random}#random`],

        //  ~~~~~~~~~~~~~~~ BLACKLISTED ~~~~~~~~~~~~~~~
        // ["wasi:http/*", `${shimPaths.http}#*`],
        // We should not provide the http shim.
        // Plugins should not be able to make HTTP requests except those that are wrapped in an
        //   interface provided by the host imports.

        // ["wasi:sockets/*", `${wasi_shimName}#*`],
        // Sockets are not actually supported in the browser shim.
    ];
    // If the transpiled library contains bizarre inputs, such as:
    //    import {  as _, } from './shim.js';
    // It is very likely an issue with an invalid import mapping.

    const wasi_shimFiles: Array<[FilePath, Code]> = [
        [shimPaths.cli, cliShimCode],
        [shimPaths.clocks, clocksShimCode],
        [shimPaths.filesystem, filesystemShimCode],
        [shimPaths.io, ioShimCode],
        [shimPaths.random, randomShimCode],
    ];

    return {
        importMap: nameMapping,
        files: wasi_shimFiles, // Provide the dynamically loaded shim code
    };
}

async function getHostImports(): Promise<ImportDetails> {
    const hostShimName = "./host-api.js"; // internal name used by bundler
    const host_importMap: Array<[PkgId, FilePath]> = [
        [`host:common/*`, `${hostShimName}#*`],
    ];
    const host_ShimFile: [FilePath, Code] = [hostShimName, hostShimCode];
    return {
        importMap: host_importMap,
        files: [host_ShimFile],
    };
}

async function getPrivilegedImports(): Promise<ImportDetails> {
    const privilegedShimName = "./privileged-api.js"; // internal name used by bundler
    const privileged_importMap: Array<[PkgId, FilePath]> = [
        [`host:privileged/*`, `${privilegedShimName}#*`],
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
    wasmBytes: Uint8Array,
    pluginHost: HostInterface,
    api: ComponentAPI,
) {
    const imports = mergeImports(
        await Promise.all([
            getWasiImports(),
            getHostImports(),
            getPrivilegedImports(),
            getProxiedImports(api.importedFuncs),
            getNonstandardWasiImports(),
        ]),
    );
    const pluginModule = await load(
        wasmBytes,
        imports,
        `${pluginHost.myServiceAccount()}.plugin.js`,
    );
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

    const onwarn = (warning: any, warn: (warning: any) => void) => {
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
