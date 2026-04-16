import { getJson, siblingUrl } from "@psibase/common-lib";

import { loadBasic } from "./component-loading";
import { DownloadFailed } from "./errors";

export const wasmFromUrl = async (url: string) => {
    let headers: [string, string][] = [];
    if (queryToken) {
        headers = [["Authorization", `Bearer ${queryToken}`]];
    } 
    return fetch(url, {
        headers,
    })
        .then((res) => {
            if (!res.ok) throw new DownloadFailed(url);
            return res.arrayBuffer();
        })
        .then((buffer) => new Uint8Array(buffer));
};

export const serviceFromOrigin = (callerOrigin: string): string | undefined => {
    const extractRootDomain = (origin: string): string => {
        const url = new URL(origin);
        const parts = url.hostname.split(".");
        parts.shift();
        return `${parts.join(".")}${url.port ? ":" + url.port : ""}`;
    };

    const callerRoot = extractRootDomain(callerOrigin);
    const myRoot = extractRootDomain(window.origin);

    return callerRoot === myRoot
        ? new URL(callerOrigin).hostname.split(".")[0]
        : undefined;
};

export interface OriginationData {
    app: string | undefined;
    origin: string;
}

export interface QualifiedOriginationData extends OriginationData {
    app: string;
}

export const assert = (condition: boolean, errorMessage: string): void => {
    if (!condition) throw new Error(errorMessage);
};

let modulePromise: Promise<any>;

// Captured once when the component parser is loaded. The parser is a
// permanent, always-instantiated utility WASM component (same shape as a
// plugin — primary core + WASI adapter etc.), so its Memory allocations
// count toward the persistent VAS overhead. Under the current call-scoped
// plugin policy it is the only WASM allocation retained between entry()
// calls; supervisor reports surface these counts in the "retained" line.
// Exposed via getters so callers always see the latest values regardless
// of module/bundler live-binding semantics.
let _parserCoreCount = 0;
let _parserMemoryCount = 0;
export const getParserCoreCount = (): number => _parserCoreCount;
export const getParserMemoryCount = (): number => _parserMemoryCount;

export const parser = (): Promise<any> => {
    if (!modulePromise) {
        const url = siblingUrl(
            null,
            "supervisor",
            "/common/component_parser.wasm",
        );
        modulePromise = wasmFromUrl(url)
            .then((bytes) => loadBasic(bytes, "component-parser.js"))
            .then(({ exports, coreCount, memoryCount }) => {
                _parserCoreCount = coreCount;
                _parserMemoryCount = memoryCount;
                return exports;
            });
    }
    return modulePromise;
};

let queryToken: string | undefined;
export const setQueryToken = (token: string | undefined) => (queryToken = token);

export let chainId: string | undefined;
const getChainId = (): Promise<string> => {
    if (!chainId) {
        return getJson("/common/chainid").then((id: string) => {
            chainId = id;
            return id;
        });
    }
    return Promise.resolve(chainId);
};
export const chainIdPromise: Promise<string> = getChainId();

export const isString = (value: any): value is string => {
    return typeof value === "string";
};

export const isEmbedded: boolean = (() => {
    try {
        return (
            window.top?.location.origin ===
            siblingUrl(null, "supervisor", null, true)
        );
    } catch {
        return false;
    }
})();
