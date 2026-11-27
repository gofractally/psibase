// Transactions signed by an account's owner key.
//
// The owner key exists only on this page, for a moment after a passkey
// prompt, so the actions that only it may authorise (changing keys, the
// recovery partner, pausing, freezing) are packed, signed and submitted from
// here instead of through the supervisor's key store.
import { sha256 } from "@noble/hashes/sha256";

import { bytesToHex, hexToBytes, publicKeyHex, signDigest } from "./account-keys";

const VERIFIER_K1 = "verify-k1";
const AUTH_SERVICE = "auth-sig";

export interface OwnerAction {
    method: string;
    /** JSON arguments of the auth service's action. */
    data: unknown;
    /** Defaults to the account itself. */
    sender?: string;
}

const postForBytes = async (
    url: string,
    json: unknown,
    token?: string,
): Promise<Uint8Array> => {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            // The node wants to know who is asking, even to pack an action.
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(json),
    });
    if (!res.ok) {
        throw new Error((await res.text()) || "The network refused the request.");
    }
    return new Uint8Array(await res.arrayBuffer());
};

/**
 * Signs `actions` as `account` with its owner key and submits them. Returns
 * once the transaction has been applied; throws with the network's reason if
 * it was refused.
 */
export const pushAsOwner = async (
    net: { siblingOrigin: (service: string) => string; token: string },
    account: string,
    ownerSecret: Uint8Array,
    actions: OwnerAction[],
): Promise<void> => {
    const packedActions = await Promise.all(
        actions.map(async (action) => ({
            sender: action.sender ?? account,
            service: AUTH_SERVICE,
            method: action.method,
            rawData: bytesToHex(
                await postForBytes(
                    `${net.siblingOrigin(AUTH_SERVICE)}/pack_action/${action.method}`,
                    action.data,
                    net.token,
                ),
            ),
        })),
    );
    const tapos = (await (await fetch("/common/tapos/head")).json()) as {
        refBlockIndex: number;
        refBlockSuffix: number;
    };
    const transaction = {
        tapos: {
            ...tapos,
            flags: 0,
            expiration: new Date(Date.now() + 30_000)
                .toISOString()
                .replace(/\.\d+Z$/, "Z"),
        },
        actions: packedActions,
        claims: [{ service: VERIFIER_K1, rawData: publicKeyHex(ownerSecret) }],
    };
    const packed = await postForBytes("/common/pack/Transaction", transaction);
    const proof = signDigest(sha256(packed), ownerSecret);
    const signed = await postForBytes("/common/pack/SignedTransaction", {
        transaction,
        proofs: [proof],
    });
    const res = await fetch(
        `${net.siblingOrigin("transact")}/push_transaction?wait_for=applied`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                Accept: "application/json",
            },
            body: new Blob([signed.buffer as ArrayBuffer]),
        },
    );
    const trace = res.ok
        ? ((await res.json()) as { error?: string | null })
        : { error: await res.text() };
    if (trace.error) throw new Error(trace.error);
};

export { hexToBytes };
