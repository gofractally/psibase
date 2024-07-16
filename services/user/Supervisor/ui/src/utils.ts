import { siblingUrl } from "@psibase/common-lib";
import { DownloadFailed } from "./errors";
import { loadBasic } from "./component-loading";

export const wasmFromUrl = (url: string) =>
    fetch(url)
        .then((res) => {
            if (!res.ok) throw new DownloadFailed(url);
            return res.arrayBuffer();
        })
        .then((buffer) => new Uint8Array(buffer));

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

export const assert = (condition: boolean, errorMessage: string): void => {
    if (!condition) throw new Error(errorMessage);
};

export function assertTruthy<T>(
    variable: T | undefined | null,
    errorMessage: string,
    condition: boolean = true,
): asserts variable is T {
    if (!condition || variable == null) {
        throw new Error(errorMessage);
    }
}

let modulePromise: Promise<any>;

export const parser = (): Promise<any> => {
    if (!modulePromise) {
        const url = siblingUrl(
            null,
            "supervisor",
            "/common/component_parser.wasm",
        );
        modulePromise = wasmFromUrl(url).then((bytes) =>
            loadBasic(bytes, "Component parser"),
        );
    }
    return modulePromise;
};
