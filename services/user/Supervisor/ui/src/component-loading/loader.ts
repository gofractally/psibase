import { transpile } from "@bytecodealliance/jco";
import { rollup } from "@rollup/browser";

import { HostInterface } from "../hostInterface.js";
import { assert } from "../utils.js";
import { ComponentAPI, Functions } from "../witExtraction.js";
import hostShimCode from "./host-api.js?raw";
import { Code, FilePath, ImportDetails, PkgId } from "./importDetails.js";
import { plugin } from "./index.js";
import privilegedShimCode from "./privileged-api.js?raw";
import { ProxyPkg } from "./proxy/proxyPackage.js";

const wasiShimURL = new URL("./shims/wasip2-shim.js", import.meta.url);

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

    const wasi_shimCode = await fetch(wasiShimURL).then((r) => r.text());
    const wasi_ShimFile: [FilePath, Code] = [wasi_shimName, wasi_shimCode];
    return {
        importMap: wasi_nameMapping,
        files: [wasi_ShimFile],
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

async function load(
    wasmBytes: Uint8Array,
    imports: ImportDetails,
    debugFileName: string,
) {
    const name = "component";
    const opts = {
        name,
        map: imports.importMap ?? {},
        validLiftingOptimization: false,
        noTypescript: true,
        noNodejsCompat: true,
        tlaCompat: false,
        base64Cutoff: 4096,
    } as any;
    // todo: delete "as any" after bytecodealliance/jco#462 is addressed.
    //       and also after the type annotations of `opts.map` has been fixed

    const {
        files,
        imports: _imports,
        exports: _exports,
    } = await transpile(wasmBytes, opts);
    const files_2 = files as unknown as Array<[string, Uint8Array]>; // todo: can delete this once type annotations for transpile are fixed

    const bundleCode: string = await rollup({
        input: name + ".js",
        plugins: [plugin([...files_2, ...imports.files], true, debugFileName)],
    })
        .then((bundle) => bundle.generate({ format: "es" }))
        .then(({ output }) => output[0].code);

    const namedBundleCode = `${bundleCode}\n//# sourceURL=${debugFileName}`;

    const blob = new Blob([namedBundleCode], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);

    const mod = await import(/* @vite-ignore */ url);

    return mod;
}

// Loads a transpiled component into an ES module, while only satisfying wasi imports
// Not sufficient for plugins, which require other direct host exports, but can be used
//   to run various other utilities in the browser that have been compiled into wasm
//   components.
export async function loadBasic(wasmBytes: Uint8Array, debugFileName: string) {
    const wasiImports = await getWasiImports();
    const name = "component";
    const opts = {
        name,
        map: wasiImports.importMap,
        validLiftingOptimization: false,
        noNodejsCompat: true,
        tlaCompat: false,
        base64Cutoff: 4096,
    } as any; // todo: delete "as any" after bytecodealliance/jco#462 is addressed.

    const { files } = await transpile(wasmBytes, opts);
    const files_2 = files as unknown as Array<[string, Uint8Array]>; // todo: delete after transpile type annotations fixed

    const bundleCode: string = await rollup({
        input: name + ".js",
        plugins: [plugin(files_2, false, debugFileName)],
    })
        .then((bundle) => bundle.generate({ format: "es" }))
        .then(({ output }) => output[0].code);

    const namedBundleCode = `${bundleCode}\n//# sourceURL=${debugFileName}`;
    const blob = new Blob([namedBundleCode], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);

    const mod = await import(/* @vite-ignore */ url);

    return mod;
}
