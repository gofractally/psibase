type Json = string | object;

let baseUrl = "";

export function setBaseUrl(_baseUrl: string) {
    baseUrl = _baseUrl;
}

export class RPCError extends Error {
    trace: any;
    constructor(message: string, trace: any = undefined) {
        super(message);
        this.trace = trace;
    }
}

export async function throwIfError(response: Response): Promise<Response> {
    console.info("throwIfError().response:", response);
    if (!response.ok) {
        const text = await response.text();
        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            throw new RPCError(text);
        }
        if (json?.error?.what) throw new RPCError(json.error.what);
        throw new RPCError(text);
    }
    return response;
}

export async function get(url: string): Promise<Response> {
    return await throwIfError(await fetch(baseUrl + url, { method: "GET" }));
}

export async function postText(url: string, text: string): Promise<Response> {
    return await throwIfError(
        await fetch(baseUrl + url, {
            method: "POST",
            headers: {
                "Content-Type": "text",
            },
            body: text,
        })
    );
}

export async function postJson(url: string, json: Json): Promise<Response> {
    return await throwIfError(
        await fetch(baseUrl + url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "true",
            },
            body: JSON.stringify(json),
        })
    );
}

export async function postArrayBuffer(
    url: string,
    arrayBuffer: ArrayBuffer
): Promise<Response> {
    return await throwIfError(
        await fetch(baseUrl + url, {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                "Access-Control-Allow-Origin": "true",
            },
            body: arrayBuffer,
        })
    );
}

export async function getJson(url: string): Promise<Json> {
    return await (await get(url)).json();
}

export async function postTextGetJson(
    url: string,
    text: string
): Promise<Json> {
    return await (await postText(url, text)).json();
}

export async function postJsonGetJson(
    url: string,
    json: Json
): Promise<Response> {
    return await (await postJson(url, json)).json();
}

export async function postJsonGetText(
    url: string,
    json: Json
): Promise<string> {
    return await (await postJson(url, json)).text();
}

export async function postJsonGetArrayBuffer(
    url: string,
    json: Json
): Promise<ArrayBuffer> {
    return await (await postJson(url, json)).arrayBuffer();
}

export async function postArrayBufferGetJson(
    url: string,
    arrayBuffer: ArrayBuffer
) {
    return await (await postArrayBuffer(url, arrayBuffer)).json();
}

export async function packSignedTransaction(
    signedTransaction: Json
): Promise<ArrayBuffer> {
    return await postJsonGetArrayBuffer(
        "/common/pack/SignedTransaction",
        signedTransaction
    );
}

export async function pushPackedTransaction(packed: ArrayBuffer): Promise<any> {
    const trace = await postArrayBufferGetJson(
        "/native/push_transaction",
        packed
    );
    if (trace.error) throw new RPCError(trace.error, trace);
    return trace;
}

export async function pushedSignedTransaction(
    signedTransaction: Json
): Promise<any> {
    return await pushPackedTransaction(
        await packSignedTransaction(signedTransaction)
    );
}

export function uint8ArrayToHex(data: any): string {
    let result = "";
    for (const x of data) {
        result += ("00" + x.toString(16)).slice(-2);
    }
    return result.toUpperCase();
}

export function hexToUint8Array(hex: string): Uint8Array {
    if (typeof hex !== "string") {
        throw new Error("Expected string containing hex digits");
    }
    if (hex.length % 2) {
        throw new Error("Odd number of hex digits");
    }
    const l = hex.length / 2;
    const result = new Uint8Array(l);
    for (let i = 0; i < l; ++i) {
        const x = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(x)) {
            throw new Error("Expected hex string");
        }
        result[i] = x;
    }
    return result;
}
