/*
    Original source: https://github.com/DougAnderson444/rollup-plugin-wit-component
*/

// transpile our wasm code into a JavaScript module
import { transpile } from "@bytecodealliance/jco";
// rollup our JavaScript module into a single file
import { rollup } from "@rollup/browser";
// ensure that our wasm code is converted to BlobUrls
import { plugin } from "./index.js";

// We need the full text of the shim in order to satisfy our import requirements
const shimSourceURL = new URL("./bundled/_preview2-shim.js", import.meta.url);

/**
 * Call this loader function to combine the wasm bytes and imports into a fully wired JavaScript module.
 *
 * @param {Uint8Array} wasmBytes - The arrayBuffer bytes of the wasm file
 * @param {String} importables - An array of objects with WIT package import name and a string of JavaScript code that exports the functions that the wasm component will us
, for example [{ 'component:cargo-comp/imports': importableCode }, { 'component:cargo-comp/more': moreCode }]
 * @returns {Promise} - A promise that resolves to the module
 */
export async function load(wasmBytes, importables = []) {
    const shimSource = await fetch(shimSourceURL).then((r) => r.text());

    /**
     * These names are all arbitary.
     * They are only used internally by the bundler. But we need to call them _something_, so these are the names:
     */
    let shimName = "./shim.js";
    let name = "component";

    // Turn the `importables` array of objects such as  [{ 'component:cargo-comp/imports': importableCode }, { 'component:cargo-comp/more': moreCode }] into two mappings:
    // 1. A single object { 'component:cargo-comp/imports': './component_cargo-comp_imports.js', 'component:cargo-comp/more': './component_cargo-comp_more.js' }
    // 2. An array of arrays [ ['./component_cargo-comp_imports.js', importableCode], ['./component_cargo-comp_more.js', moreCode] ]
    importables = importables.reduce(
        (acc, current) => {
            let name = Object.keys(current)[0];
            let code = current[name];
            let globImportPattern = /\/\*$/;
            let filePath =
                "./" +
                name
                    .replace(globImportPattern, "")
                    .replace(":", "_")
                    .replace(/\//g, "_") +
                ".js";
            acc[0][name] =
                filePath + (name.match(globImportPattern) ? "#*" : "");
            acc[1].push([filePath, code]);
            return acc;
        },
        [{}, []],
    );

    // We roll up the bytes, about 3.5 MB worth. You could instead of uses a CDN like unpkg.com.
    // This map function tells the bundler under what name the code is mapped to.
    let map = Object.assign(
        {
            // Using bundled shim is faster (but bigger: 3.5MB) than CDN https://unpkg.com/@bytecodealliance/preview2-shim/lib/browser/index.js
            "wasi:cli/*": `${shimName}#*`,
            "wasi:filesystem/*": `${shimName}#*`,
            "wasi:io/*": `${shimName}#*`,
            "wasi:sockets/*": `${shimName}#*`,
            "wasi:random/*": `${shimName}#*`,
            "wasi:clocks/*": `${shimName}#*`,
            "wasi:http/*": `${shimName}#*`,
        },
        {
            // specify location of imported functions, if applicable
            ...importables[0],
        },
    );

    let opts = {
        name,
        map: Object.entries(map ?? {}),
        validLiftingOptimization: false,
        noNodejsCompat: true,
        tlaCompat: false,
        base64Cutoff: 4096,
    };

    // pass into generate along with bytes
    let { files, imports, exports } = await transpile(wasmBytes, opts);

    // Bundle all the imports into one file, using URLs to link to the wasm blobs
    let code = await rollup({
        input: name + ".js",
        plugins: [
            plugin([...files, ...importables[1], [shimName, shimSource]]),
        ],
    })
        .then((bundle) => bundle.generate({ format: "es" }))
        .then(({ output }) => output[0].code);

    // generate url from code blob
    let blob = new Blob([code], { type: "text/javascript" });
    let url = URL.createObjectURL(blob);

    let mod = await import(/* @vite-ignore */ url);

    return mod;
}
