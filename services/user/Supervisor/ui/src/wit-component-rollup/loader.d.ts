/**
 * Call this loader function to combine the wasm bytes and imports into a fully wired JavaScript module.
 *
 * @param {Uint8Array} wasmBytes - The arrayBuffer bytes of the wasm file
 * @param {String} importables - An array of objects with WIT package import name and a string of JavaScript code that exports the functions that the wasm component will us
, for example [{ 'component:cargo-comp/imports': importableCode }, { 'component:cargo-comp/more': moreCode }]
 * @returns {Promise} - A promise that resolves to the module
 */
export function load(wasmBytes: Uint8Array, importables?: string): Promise<any>;
