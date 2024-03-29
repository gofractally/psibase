import {
    privateStringToKeyPair,
    publicKeyPairToDER,
    signatureToBin,
} from "./keyConversions";
import hashJs from "hash.js";

export class RPCError extends Error {
    trace: any;

    constructor(message: any, trace?: any) {
        super(message);
        this.trace = trace;
    }
}

export type ChangeHistoryPayload = {
    pathname: string;
    search: string;
    hash: string;
};

export interface GetClaimParams {
    service: string;
    sender: string;
    method: string;
    params: any;
}

export type Claim = {
    service: string;
    rawData: string; // hex bytes
};

export type WrappedClaim = {
    claim: Claim;
    pubkey: string; // Public key string
};

export type MessageMetadata = {
    sender: string;
};

export function siblingUrl(
    baseUrl?: string | null,
    subDomain?: string | null,
    path?: string | null,
    baseUrlIncludesSibling = true,
): string {
    const currentUrl = new URL(baseUrl || window.location.href);
    const hostnameParts = currentUrl.hostname.split(".");
    if (baseUrlIncludesSibling) {
        hostnameParts.shift();
    }
    if (subDomain) {
        hostnameParts.unshift(subDomain);
    }
    currentUrl.hostname = hostnameParts.join(".");
    const computedPath = path ? `/${path.replace(/^\/+/, "")}` : ``;
    return currentUrl.origin + computedPath;
}

export async function throwIfError(response: Response) {
    if (!response.ok) {
        throw new RPCError(await response.text());
    }
    return response;
}

export async function get(url: string, options = {}) {
    const res = await fetch(url, { ...options, method: "GET" });
    return throwIfError(res);
}

export async function getText(url: string) {
    const res = await get(url);
    return res.text();
}

export async function getJson<T = any>(url: string): Promise<T> {
    const res = await get(url, { headers: { Accept: "application/json" } });
    return res.json();
}

export async function getArrayBuffer(url: string) {
    const res = await get(url);
    return res.arrayBuffer();
}

export async function postText(url: string, text: string) {
    return throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "text",
            },
            body: text,
        }),
    );
}

export async function postGraphQL(url: string, graphql: string) {
    return throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/graphql",
            },
            body: graphql,
        }),
    );
}

export async function postJson(url: string, json: any) {
    return throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(json),
        }),
    );
}

export async function postArrayBuffer(url: string, arrayBuffer: any) {
    return throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
            },
            body: arrayBuffer,
        }),
    );
}

export async function postTextGetJson(url: string, text: string) {
    const res = await postText(url, text);
    return res.json();
}

export async function postGraphQLGetJson<GqlResponse>(
    url: string,
    graphQL: string,
): Promise<GqlResponse> {
    const res = await postGraphQL(url, graphQL);
    return res.json();
}

export async function postJsonGetJson(url: string, json: any) {
    const res = await postJson(url, json);
    return res.json();
}

export async function postJsonGetText(url: string, json: any) {
    const res = await postJson(url, json);
    return res.text();
}

export async function postJsonGetArrayBuffer(url: string, json: any) {
    const res = await postJson(url, json);
    return res.arrayBuffer();
}

export async function postArrayBufferGetJson(url: string, arrayBuffer: any) {
    const res = await postArrayBuffer(url, arrayBuffer);
    return res.json();
}

export async function getTaposForHeadBlock(baseUrl = "") {
    const url = baseUrl.replace(/\/+$/, "") + "/common/tapos/head";
    return getJson(url);
}

export async function packAction(baseUrl: string, action: any) {
    let { sender, service, method, data, rawData } = action;
    if (!rawData) {
        rawData = uint8ArrayToHex(
            new Uint8Array(
                await postJsonGetArrayBuffer(
                    await siblingUrl(
                        baseUrl,
                        service,
                        "/pack_action/" + method,
                    ),
                    data,
                ),
            ),
        );
    }
    return { sender, service, method, rawData };
}

export async function packActions(baseUrl: string, actions: any[]) {
    return await Promise.all(
        actions.map((action) => packAction(baseUrl, action)),
    );
}

export async function packTransaction(baseUrl: string, transaction: any) {
    return await postJsonGetArrayBuffer(
        baseUrl.replace(/\/+$/, "") + "/common/pack/Transaction",
        {
            ...transaction,
            actions: await packActions(baseUrl, transaction.actions),
        },
    );
}

export async function packAndDigestTransaction(
    baseUrl: string,
    transaction: any,
) {
    const packedBytes = new Uint8Array(
        await packTransaction(baseUrl, transaction),
    );
    const digest = new (hashJs as any).sha256().update(packedBytes).digest();
    return { transactionHex: uint8ArrayToHex(packedBytes), digest };
}

export async function packSignedTransaction(
    baseUrl: string,
    signedTransaction: any,
) {
    if (typeof signedTransaction.transaction !== "string")
        signedTransaction = {
            ...signedTransaction,
            transaction: uint8ArrayToHex(
                new Uint8Array(
                    await packTransaction(
                        baseUrl,
                        signedTransaction.transaction,
                    ),
                ),
            ),
        };
    return await postJsonGetArrayBuffer(
        baseUrl.replace(/\/+$/, "") + "/common/pack/SignedTransaction",
        signedTransaction,
    );
}

export async function pushPackedSignedTransaction(
    baseUrl: string,
    packed: any,
) {
    const trace = await postArrayBufferGetJson(
        baseUrl.replace(/\/+$/, "") + "/native/push_transaction",
        packed,
    );
    if (trace.error) throw new RPCError(trace.error, trace);
    return trace;
}

export async function packAndPushSignedTransaction(
    baseUrl: string,
    signedTransaction: any,
) {
    return await pushPackedSignedTransaction(
        baseUrl,
        await packSignedTransaction(baseUrl, signedTransaction),
    );
}

export async function signTransaction(
    baseUrl: string,
    transaction: any,
    privateKeys: string[],
) {
    const keys = (privateKeys || []).map((k) => {
        if (typeof k === "string") return privateStringToKeyPair(k);
        else return k;
    });
    const claims = keys.map((k) => ({
        service: "verify-sig",
        rawData: uint8ArrayToHex(publicKeyPairToDER(k)),
    }));
    transaction = new Uint8Array(
        await packTransaction(baseUrl, { ...transaction, claims }),
    );
    const digest = new (hashJs as any).sha256().update(transaction).digest();
    const proofs = keys.map((k) =>
        uint8ArrayToHex(
            signatureToBin({
                keyType: k.keyType,
                signature: k.keyPair.sign(digest),
            }),
        ),
    );
    const signedTransaction = uint8ArrayToHex(transaction);
    const result = { transaction: signedTransaction, proofs };
    return result;
}

/**
 * Description: Signs and pushes a transaction object to the baseUrl endpoint
 *
 * @param {String} baseUrl - The URL endpoint to which to push the signed transaction
 * @param {Object} transaction - A JSON object that follows the transaction schema to define a collection of actions to execute
 * @param {Array} privateKeys - An array of strings that represent private keys used to sign this transaction
 */
export async function signAndPushTransaction(
    baseUrl: string,
    transaction: any,
    privateKeys: string[],
) {
    try {
        console.log("Signing transaction...", {
            baseUrl,
            transaction,
            privateKeys,
        });
        const signedTransaction = await signTransaction(
            baseUrl,
            transaction,
            privateKeys,
        );
        console.log("Successfully signed transaction", { signedTransaction });

        try {
            console.log("Pushing transaction...");
            const pushedTransaction = await packAndPushSignedTransaction(
                baseUrl,
                signedTransaction,
            );
            console.log("Transaction pushed!", { pushedTransaction });
            return pushedTransaction;
        } catch (e: any) {
            console.error("Failed pushing transaction", e);
            throw new Error(e);
        }
    } catch (e: any) {
        console.error("Failed signing transaction", e);
        throw new Error(e);
    }
}

export function uint8ArrayToHex(data: Uint8Array) {
    let result = "";
    for (const x of data) result += ("00" + x.toString(16)).slice(-2);
    return result.toUpperCase();
}

export function hexToUint8Array(hex: string) {
    if (typeof hex !== "string")
        throw new Error("Expected string containing hex digits");
    if (hex.length % 2) throw new Error("Odd number of hex digits");
    const l = hex.length / 2;
    const result = new Uint8Array(l);
    for (let i = 0; i < l; ++i) {
        const x = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(x)) throw new Error("Expected hex string");
        result[i] = x;
    }
    return result;
}

export const ErrorCodes = {
    invalidResource: 404,
    serverError: 500,
};

export const ErrorMessages = [
    {
        code: ErrorCodes.invalidResource,
        message: "Error 404: Resource not found",
    },
    {
        code: ErrorCodes.serverError,
        message: "Error 500: Server error, possibly incorrect transaction data",
    },
];
