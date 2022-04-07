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

export async function postJsonGetJson(url, json) {
    return await (await postJson(url, json)).json();
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
