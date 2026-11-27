// The list of a passkey's accounts (gofractally/psibase#2275, section 4.2).
//
// The keys of an account depend on its name and sequence values, so a
// passkey alone does not say which accounts exist. The list is kept on the
// node as one opaque blob:
//
//   locator = H(5, root)     where it is stored; only the passkey holder can compute it
//   key     = H(6, root)     AES-256-GCM key; never leaves this page
//   blob    = nonce[12] || AES-GCM(key, nonce, plaintext[4068])      always 4096 bytes
//   plaintext = u32le(length) || utf8(JSON) || zero padding
//
// The fixed size hides how many accounts there are. Writes are signed by the
// guest key, which the node binds to the locator on the first write.
import { bytesToHex, hexToBytes, sha256Hex, signText } from "./account-keys";

export interface ListedAccount {
    name: string;
    /** u64 values as decimal strings. */
    ownerSeq: string;
    activeSeq: string;
}

export interface AccountList {
    accounts: ListedAccount[];
    /** The version the node holds; 0 when nothing is stored yet. */
    version: number;
}

const BLOB_SIZE = 4096;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const PLAIN_SIZE = BLOB_SIZE - NONCE_SIZE - TAG_SIZE;

const aesKey = (key: Uint8Array, usage: KeyUsage) =>
    crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [usage]);

export const sealList = async (
    key: Uint8Array,
    accounts: ListedAccount[],
): Promise<Uint8Array> => {
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, accounts }));
    if (json.length > PLAIN_SIZE - 4) {
        throw new Error("This passkey holds too many accounts to list.");
    }
    const plain = new Uint8Array(PLAIN_SIZE);
    new DataView(plain.buffer).setUint32(0, json.length, true);
    plain.set(json, 4);
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce },
            await aesKey(key, "encrypt"),
            plain,
        ),
    );
    const blob = new Uint8Array(BLOB_SIZE);
    blob.set(nonce, 0);
    blob.set(sealed, NONCE_SIZE);
    return blob;
};

export const openList = async (
    key: Uint8Array,
    blob: Uint8Array,
): Promise<ListedAccount[]> => {
    if (blob.length !== BLOB_SIZE) throw new Error("Unexpected account list size");
    const plain = new Uint8Array(
        await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: blob.slice(0, NONCE_SIZE) as BufferSource },
            await aesKey(key, "decrypt"),
            blob.slice(NONCE_SIZE) as BufferSource,
        ),
    );
    const length = new DataView(plain.buffer).getUint32(0, true);
    if (length > PLAIN_SIZE - 4) throw new Error("Unexpected account list");
    const parsed = JSON.parse(
        new TextDecoder().decode(plain.subarray(4, 4 + length)),
    ) as { accounts?: ListedAccount[] };
    return (parsed.accounts ?? []).filter(
        (a) =>
            typeof a?.name === "string" &&
            /^\d+$/.test(a.ownerSeq) &&
            /^\d+$/.test(a.activeSeq),
    );
};

/** The text the guest key signs for a write. */
export const writeMessage = (locatorHex: string, version: number, blob: Uint8Array) =>
    `psibase account list\n${locatorHex}\n${version}\n${sha256Hex(blob)}`;

export interface ListStore {
    /** Base address of the service that keeps the list. */
    origin: string;
    locator: Uint8Array;
    key: Uint8Array;
}

export const fetchList = async (store: ListStore): Promise<AccountList> => {
    const res = await fetch(`${store.origin}/list/${bytesToHex(store.locator)}`);
    if (res.status === 404) return { accounts: [], version: 0 };
    if (!res.ok) throw new Error("Could not read your account list.");
    const reply = (await res.json()) as { blob: string; version: number };
    return {
        accounts: await openList(store.key, hexToBytes(reply.blob)),
        version: reply.version,
    };
};

/**
 * Applies `change` to the stored list and writes it back. A write that lost
 * a race with another device is read again and retried.
 */
export const updateList = async (
    store: ListStore,
    guest: { publicKey: string; secret: Uint8Array },
    change: (accounts: ListedAccount[]) => ListedAccount[],
): Promise<ListedAccount[]> => {
    const locatorHex = bytesToHex(store.locator);
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; ++attempt) {
        const current = await fetchList(store);
        const accounts = change(current.accounts);
        const blob = await sealList(store.key, accounts);
        const version = current.version + 1;
        const res = await fetch(`${store.origin}/list/${locatorHex}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                blob: bytesToHex(blob),
                key: guest.publicKey,
                version,
                sig: signText(writeMessage(locatorHex, version, blob), guest.secret),
            }),
        });
        if (res.ok) return accounts;
        lastStatus = res.status;
        if (res.status !== 409) break;
    }
    throw new Error(`Could not save your account list (${lastStatus}).`);
};

/** `accounts` with `entry` added or replaced. */
export const withAccount = (accounts: ListedAccount[], entry: ListedAccount) => [
    ...accounts.filter((a) => a.name !== entry.name),
    entry,
];
