import { BodyType, HttpRequest } from "../host-interface";

export interface RawHttpResponse {
    status: number;
    headers: Array<[string, string]>;
    contentType: string;
    body: Uint8Array;
}

function toRequestBody(body?: BodyType): BodyInit | undefined {
    if (!body) {
        return undefined;
    }
    const val = body.val;
    if (typeof val === "string") {
        return val.length > 0 ? val : undefined;
    }
    if (val instanceof Uint8Array) {
        // Copy out of wasm memory; JSPI may resume other work before fetch reads it.
        return val.byteLength > 0 ? val.slice() : undefined;
    }
    return undefined;
}

export function headersRecord(
    headers: { key: string; value: string }[],
): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach(({ key, value }) => {
        record[key] = value;
    });
    return record;
}

import { slog, watchHang } from "../debug";

export async function performHttpRequest(
    req: HttpRequest,
    uri: string,
    withCredentials: boolean,
): Promise<RawHttpResponse> {
    const headers = new Headers(headersRecord(req.headers));
    headers.delete("user-agent");
    headers.delete("host");

    const response = await watchHang(
        `fetch ${req.method} ${uri}`,
        () =>
            fetch(uri, {
                method: req.method.toString(),
                headers,
                body: toRequestBody(req.body),
                credentials: withCredentials ? "include" : "same-origin",
            }),
    );
    slog(`fetch status ${response.status} ${uri}`);

    const responseHeaders: Array<[string, string]> = [];
    response.headers.forEach((value, key) => {
        responseHeaders.push([key, value]);
    });

    return {
        status: response.status,
        headers: responseHeaders,
        contentType: response.headers.get("content-type") || "",
        body: new Uint8Array(await response.arrayBuffer()),
    };
}
