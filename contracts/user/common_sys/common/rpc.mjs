export class RPCError extends Error {
    constructor(message, trace) {
        super(message)
        this.trace = trace;
    }
}

export async function throwIfError(response) {
    if (!response.ok) {
        const text = await response.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            throw new RPCError(text);
        }
        if (json?.error?.what)
            throw new RPCError(json.error.what);
        throw new RPCError(text);
    }
    return response;
}

export async function get(url, text) {
    return await throwIfError(await fetch(url, { method: 'GET' }));
}

export async function postText(url, text) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'text'
        },
        body: text,
    }));
}

export async function postJson(url, json) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(json),
    }));
}

export async function postArrayBuffer(url, arrayBuffer) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream'
        },
        body: arrayBuffer,
    }));
}

export async function getJson(url) {
    return await (await get(url)).json();
}

export async function postTextGetJson(url, text) {
    return await (await postText(url, text)).json();
}

export async function postJsonGetJson(url, json) {
    return await (await postJson(url, json)).json();
}

export async function postJsonGetText(url, json) {
    return await (await postJson(url, json)).text();
}

export async function postJsonGetArrayBuffer(url, json) {
    return await (await postJson(url, json)).arrayBuffer();
}

export async function postArrayBufferGetJson(url, arrayBuffer) {
    return await (await postArrayBuffer(url, arrayBuffer)).json();
}

export async function packSignedTransaction(signedTransaction) {
    return await postJsonGetArrayBuffer('/common/pack/signed_transaction', signedTransaction);
}

export async function pushPackedTransaction(packed) {
    const trace = await postArrayBufferGetJson('/native/push_transaction', packed);
    if (trace.error)
        throw new RPCError(trace.error, trace);
    return trace;
}

export async function pushedSignedTransaction(signedTransaction) {
    return await pushPackedTransaction(await packSignedTransaction(signedTransaction));
}

export function uint8ArrayToHex(data) {
    let result = '';
    for (const x of data) {
        result += ('00' + x.toString(16)).slice(-2);
    }
    return result.toUpperCase();
};

export function hexToUint8Array(hex) {
    if (typeof hex !== 'string') {
        throw new Error('Expected string containing hex digits');
    }
    if (hex.length % 2) {
        throw new Error('Odd number of hex digits');
    }
    const l = hex.length / 2;
    const result = new Uint8Array(l);
    for (let i = 0; i < l; ++i) {
        const x = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(x)) {
            throw new Error('Expected hex string');
        }
        result[i] = x;
    }
    return result;
};
