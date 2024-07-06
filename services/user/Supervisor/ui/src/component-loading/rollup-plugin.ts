import {OutputOptions, RenderedChunk, TransformResult} from "@rollup/browser";

const decoder = new TextDecoder();

export const plugin = (files: [string, Uint8Array|string][]) => ({
    name: "loader",

    // The purpose of resolveId is to make sure that we have URLs for every file
    //   and allowing for the possiblity of passing in various data as long as it can
    //   be resolved into a URL.
    async resolveId(importId: string, _importer: string | undefined): Promise<string> {

        if (files.find((file) => file[0] === importId)) {
            return importId;
        }

        if (importId.startsWith("http:") || importId.startsWith("https:")) {
            throw Error("Web imports disabled");
        }

        console.log("TODO: Probably want to throw an error here");
        return importId;
    },

    // Loads the code from the URLs
    async load(id: string): Promise<string> {
        let match = files.find((file) => file[0] == id); 
        if (match) {
            if (typeof match[1] === "string") 
                return match[1];
            else
                return decoder.decode(match[1]);
        }
        else throw Error(`No file found for ${id}`);
    },

    // Transforms wasm imports within js files to use a blob URL of the bytes instead 
    //   of `new URL('./${fileName}', import.meta.url)`
    async transform(code: string, id: string): Promise<TransformResult> {

        if (!id.endsWith(".js")) {
            return null;
        }

        const urlRefs = code.match(/new URL\((.*)/g);

        if (!urlRefs || !urlRefs.length) {
            return null;
        }

        urlRefs.forEach((urlReference) => {
            const fileName = urlReference.match(/'.\/(.*)'/)?.[1];
            if (!fileName?.endsWith(".wasm")) return;
    
            const fileContent = files.find(([name]) => name === fileName)?.[1];
            if (!fileContent) return;
    
            const wasmBlobUrl = URL.createObjectURL(
                new Blob([fileContent], { type: "application/wasm" }),
            );
    
            if (!wasmBlobUrl) 
                return;
    
            code = code.replace(
                `new URL('./${fileName}', import.meta.url)`,
                `'${wasmBlobUrl}'`,
            );
        });

        return {
            code,
            map: { mappings: "" },
        };
    },

    async renderChunk(code: string, chunk: RenderedChunk, _: OutputOptions) {
        console.log(chunk);
        const prependCode = `
            let host = {};

            export function __setup(pluginHost) {
                host = pluginHost;
            };

        `;
        return prependCode + code;
    }
});

