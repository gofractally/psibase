
import { transpile } from "@bytecodealliance/jco";
import { rollup } from "@rollup/browser";
import { plugin } from "./index.js";

const wasiShimURL = new URL("./bundled/_preview2-shim.js", import.meta.url);
import hostShimCode from "./host-api.js?raw";
import { HostInterface } from "../hostInterface.js";
import { ComponentAPI } from "../witExtraction.js";

type Code = string;
type PkgId = string;
type FilePath = string;
class ImportDetails {
    importMap: Array<[PkgId, FilePath]>
    files: Array<[FilePath, Code]>;
    constructor(importMap: Array<[PkgId, FilePath]>, files: Array<[FilePath, Code]>) {
        this.importMap = importMap;
        this.files = files;
    }
};

// const getImportFills = (
//     importedFuncs: ImportedFunctions,
//     resultCache: ResultCache[],
// ): { [key: string]: string }[] => {
//     const { interfaces, funcs: freeFunctions } = importedFuncs;
//     if (freeFunctions.length !== 0) {
//         // TODO: Check how this behaves if a plugin exports a freestanding function and
//         //       another plugin imports it.
//         throw Error(`TODO: Plugins may not import freestanding functions.`);
//     }

//     let importables: { [key: string]: string }[] = [];
//     let subset = interfaces.filter((i) => {
//         return !hostIntf(i) && !(i.funcs.length === 0);
//     });

//     let namespaced: FunctionIntfs = new Proxy({}, autoArrayInit);
//     subset.forEach((intf: FunctionInterface) => {
//         let key: PkgId = { ns: intf.namespace, pkg: intf.package };
//         namespaced[serializePkgId(key)].push(intf);
//     });

//     for (const [pkgId, intfs] of Object.entries(namespaced)) {
//         let imp: string[] = [];
//         intfs.forEach((intf: FunctionInterface) => {
//             imp.push(`export const ${intf.name} = {
//             `);
//             intf.funcs.forEach((f: string) => {
//                 imp.push(`${f}(...args) {
//                 `);
//                 imp.push(
//                     getFunctionBody(
//                         {
//                             service: intf.namespace,
//                             plugin: intf.package,
//                             intf: intf.name,
//                             method: f,
//                         },
//                         resultCache,
//                     ),
//                 );
//                 imp.push(`},`);
//             });
//             imp.push(`}`);
//         });
//         importables.push({ [`${pkgId}/*`]: `${imp.join("")}` });
//     }
//     return importables;
// };

// async function getDynamicImports(api: ComponentAPI) {
//     console.log(api);
// }

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

    // Bundle all the imports into one file, using URLs to link to the wasm blobs
    const wasi_shimCode = await fetch(wasiShimURL).then((r) => r.text());
    const wasi_ShimFile: [FilePath, Code] = [wasi_shimName, wasi_shimCode];

    return {
        importMap: wasi_nameMapping,
        files: [wasi_ShimFile]
    };
}

async function getHostImports(): Promise<ImportDetails> {
    const hostShimName = "./host-api.js"; // internal name used by bundler
    const host_importMap: Array<[PkgId, FilePath]> = [
        [`common:plugin/*`, `${hostShimName}#*`],
    ];
    const host_ShimFile: [FilePath, Code] = [hostShimName, hostShimCode];
    return {
        importMap: host_importMap,
        files: [host_ShimFile],
    };
}

function mergeImports(importDetails: ImportDetails[]) : ImportDetails {
    const importMap: Array<[PkgId, FilePath]> = importDetails.flatMap(detail => detail.importMap);
    const files: Array<[FilePath, Code]> = importDetails.flatMap(detail => detail.files);
    return new ImportDetails(importMap, files);
}

export async function loadPlugin(wasmBytes: Uint8Array, pluginHost: HostInterface, api: ComponentAPI) {
    const imports = mergeImports([await getWasiImports(), await getHostImports()]);
    const pluginModule = await load(wasmBytes, imports);

    console.log("Temp: Printing the component api");
    console.log(JSON.parse(api.debug));

    pluginModule.__setup(pluginHost);
    return pluginModule;
}

async function load(wasmBytes: Uint8Array, imports: ImportDetails) {
    const name = "component";
    let opts = {
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

    const { files, imports: _imports, exports: _exports } = await transpile(wasmBytes, opts);
    const files_2 = files as unknown as Array<[string, Uint8Array]>; // todo: can delete this once type annotations for transpile are fixed

    // Todo - here is a good time to check if the _imports are satisfied by the `imports.importmap` and 
    //        fire off an error, if not.
    console.info("temp: transpilation imports", _imports);
    console.info("temp: transpilation exports", _exports);

    const bundleCode: string = await rollup({
        input: name + ".js",
        plugins: [
            plugin([
                ...files_2, 
                ...imports.files
            ], true),
        ],
    })
    .then((bundle) => bundle.generate({ format: "es" }))
    .then(({ output }) => output[0].code);

    let blob = new Blob([bundleCode], { type: "text/javascript" });
    let url = URL.createObjectURL(blob);

    let mod = await import(/* @vite-ignore */ url);

    return mod;

}

// Loads a transpiled component into an ES module, while only satisfying wasi imports
// Not sufficient for plugins, which require other direct host exports, but can be used
//   to run various other utilities in the browser that have been compiled into wasm 
//   components.
export async function loadBasic(wasmBytes: Uint8Array) {

    const wasiImports = await getWasiImports();
    const name = "component";
    let opts = {
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
        plugins: [
            plugin(files_2, false),
        ],
    })
    .then((bundle) => bundle.generate({ format: "es" }))
    .then(({ output }) => output[0].code);

    let blob = new Blob([bundleCode], { type: "text/javascript" });
    let url = URL.createObjectURL(blob);

    let mod = await import(/* @vite-ignore */ url);

    return mod;
}


// Combines the wasm bytes and imports into a fully wired JavaScript module
// async function load(wasmBytes: Uint8Array, importables: ImportFills[]) {

//     // Turn the `importables` array of objects into two mappings:
//     // 1. A single object { 'component:cargo-comp/imports': './component_cargo-comp_imports.js', 'component:cargo-comp/more': './component_cargo-comp_more.js' }
//     // 2. An array of arrays [ ['./component_cargo-comp_imports.js', importableCode], ['./component_cargo-comp_more.js', moreCode] ]
//     const customImports = importables.reduce<ImportDetails>(
//         (acc, current) => {
//             const name: string = Object.keys(current)[0];
//             let globImportPattern = /\/\*$/;
//             let filePath =
//                 "./" +
//                 name
//                     .replace(globImportPattern, "")
//                     .replace(":", "_")
//                     .replace(/\//g, "_") +
//                 ".js";
//             acc.importMap[name] = filePath + (name.match(globImportPattern) ? "#*" : "");
//             acc.files.push([filePath, current[name]]);
//             return acc;
//         },
//         {importMap: {}, files: []},
//     );

//     const wasiImports = await getWasiImports();

//     const importMap = {
//             ...wasiImports.importMap,
//             ...customImports.importMap
//     };

//     const name = "component";
//     let opts = {
//         name,
//         map: importMap ?? {},
//         validLiftingOptimization: false,
//         noNodejsCompat: true,
//         tlaCompat: false,
//         base64Cutoff: 4096,
//     };

//     // pass into generate along with bytes
//     let { files, imports, exports } = await transpile(wasmBytes, opts);
//     const componentFiles = Object.entries(files).map(([filename, content]): [string, string] => [filename, decoder.decode(content)]);
//     console.info("temp: transpilation imports", imports);
//     console.info("temp: transpilation exports", exports);

//     const bundleCode: string = await rollup({
//         input: name + ".js",
//         plugins: [
//             plugin([
//                 ...componentFiles, 
//                 ...customImports.files, 
//                 ...wasiImports.files,
//             ]),
//         ],
//     })
//     .then((bundle) => bundle.generate({ format: "es" }))
//     .then(({ output }) => output[0].code);

//     let blob = new Blob([bundleCode], { type: "text/javascript" });
//     let url = URL.createObjectURL(blob);

//     let mod = await import(/* @vite-ignore */ url);

//     return mod;
// }
