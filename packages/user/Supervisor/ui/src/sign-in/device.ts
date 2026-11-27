// The accounts this browser can use, and the calls into the supervisor's
// plugins that hold their active keys.
//
// What is kept here is public: account names and the sequence values their
// keys were derived with. The active private keys are in the supervisor's
// key store; owner keys are nowhere.
import { secp256k1 } from "@noble/curves/secp256k1";

import {
    type AccountKeys,
    accountKeys,
    bytesToHex,
    hexToBytes,
    listKey,
    listLocator,
} from "./account-keys";
import {
    type ListedAccount,
    type ListStore,
    fetchList,
    updateList,
    withAccount,
} from "./account-list";
import {
    type PasskeyLabel,
    type PasskeyNotes,
    type Unlocked,
    relabelPasskey,
} from "./passkey";

// ------------------------------------------------------- this browser

const DEVICE_KEY = "psibase.accounts.v1";

/** `held` is false while this browser knows the account but has no key for it. */
export interface DeviceEntry extends ListedAccount {
    held?: boolean;
}

export interface DeviceAccounts {
    accounts: DeviceEntry[];
    /** The account this browser acts as, if any. */
    current?: string;
    /** The name the visitor chose to be shown by; optional. */
    displayName?: string;
    /** The account name chosen when the passkey was made, not yet created. */
    pendingName?: string;
    /** Base64url user id of the passkey, for telling the password manager. */
    userId?: string;
}

export const loadDevice = (): DeviceAccounts => {
    try {
        const parsed = JSON.parse(
            window.localStorage.getItem(DEVICE_KEY) ?? "{}",
        ) as Partial<DeviceAccounts>;
        const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
        const current = accounts.some((a) => a.name === parsed.current)
            ? parsed.current
            : accounts[0]?.name;
        return { ...parsed, accounts, current };
    } catch {
        return { accounts: [] };
    }
};

const saveDevice = (device: DeviceAccounts) =>
    window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));

export const rememberOnDevice = (
    entry: ListedAccount,
    makeCurrent: boolean,
    held = true,
) => {
    const device = loadDevice();
    saveDevice({
        ...device,
        accounts: withAccount(device.accounts, { ...entry, held } as DeviceEntry),
        current: makeCurrent ? entry.name : (device.current ?? entry.name),
        // The name chosen with the passkey is spoken for once it is an account.
        pendingName: device.pendingName === entry.name ? undefined : device.pendingName,
    });
};

export const setCurrent = (name: string | undefined) =>
    saveDevice({ ...loadDevice(), current: name });

export const dropFromDevice = (name: string) => {
    const device = loadDevice();
    saveDevice({
        ...device,
        accounts: device.accounts.filter((a) => a.name !== name),
        current: device.current === name ? undefined : device.current,
    });
};

export const clearDevice = () => window.localStorage.removeItem(DEVICE_KEY);

/** Keeps what a passkey prompt told us about the passkey and its holder. */
export const notePasskey = (details: {
    userId?: string;
    displayName?: string;
    pendingName?: string;
}) => {
    const device = loadDevice();
    saveDevice({
        ...device,
        userId: details.userId ?? device.userId,
        displayName: details.displayName ?? device.displayName,
        pendingName: details.pendingName ?? device.pendingName,
    });
};

/**
 * What the passkey should carry: the accounts this browser knows of, plus
 * `adding` when an account is about to be created or brought back.
 */
export const notesToWrite = (adding?: string): PasskeyNotes => {
    const device = loadDevice();
    return {
        displayName: device.displayName,
        accounts: [...device.accounts.map((a) => a.name), ...(adding ? [adding] : [])],
    };
};

/** How the passkey should read in the password manager. */
export const passkeyLabel = (): PasskeyLabel | undefined => {
    const device = loadDevice();
    const first = device.current ?? device.accounts[0]?.name ?? device.pendingName;
    if (!first) return undefined;
    const more = device.accounts.filter((a) => a.name !== first).length;
    const name = more ? `${first} +${more}` : first;
    return { name, displayName: device.displayName || name };
};

/** Brings the password manager's label up to date, where the browser can. */
export const refreshPasskeyLabel = async () => {
    const device = loadDevice();
    const label = passkeyLabel();
    if (device.userId && label) await relabelPasskey(device.userId, label);
};

// ------------------------------------------------------------ plugins

type Call = { service: string; plugin: string; intf: string; method: string; params: unknown[] };

export const callPlugin = async (call: Call, returnPath = "/"): Promise<unknown> => {
    const { getSupervisor } = await import("@psibase/common-lib");
    return getSupervisor().functionCall(call, { enabled: false, returnPath });
};

const accountsAdmin = (method: string, ...params: unknown[]): Call => ({
    service: "host",
    plugin: "accounts",
    intf: "admin",
    method,
    params,
});

/**
 * Puts an account's active key in the supervisor's key store and signs the
 * account in to `app`. The key store looks the account up through its own
 * query path, which can trail the node's view by a block, so "not found" is
 * retried.
 */
export const adoptFor = async (app: string, account: string, activePem: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; ++attempt) {
        try {
            await callPlugin(accountsAdmin("adoptAccountFor", app, account, activePem));
            return;
        } catch (e) {
            lastError = e;
            const text = String((e as Error)?.message ?? e).toLowerCase();
            if (!text.includes("not found") && !text.includes("active key")) break;
            await new Promise((r) => setTimeout(r, 700));
        }
    }
    throw lastError;
};

export const loginFor = (app: string, account: string) =>
    callPlugin(accountsAdmin("loginFor", app, account));
export const logoutFor = (app: string) =>
    callPlugin(accountsAdmin("logoutFor", app));
export const forgetAccount = (account: string) =>
    callPlugin(accountsAdmin("forgetAccount", account));

// ----------------------------------------------------- chain records

export interface ChainKey {
    key: string;
    seq: bigint;
}

export interface ChainRecord {
    account: string;
    owner: ChainKey;
    active: ChainKey;
    partner?: string;
    state: "normal" | "paused" | "frozen";
    stateUntil?: Date;
    pauseSeconds: number;
    freezeSeconds: number;
    pending?: {
        kind: "ownerKeys" | "partner" | "delays";
        owner?: ChainKey;
        partner?: string;
        pauseSeconds?: number;
        freezeSeconds?: number;
    };
    recoveryRequests: { id: number; owner: ChainKey; active: ChainKey }[];
}

const RECORD_FIELDS = `account
    owner { key seq } active { key seq } partner
    state stateUntil pauseSeconds freezeSeconds
    pending { kind owner { key seq } partner pauseSeconds freezeSeconds }
    recoveryRequests { id owner { key seq } active { key seq } }`;

// A public key however the node writes it (PEM or hex DER), as the hex of
// its compressed point, so that two spellings of one key compare equal.
const pointOf = (key: string): string => {
    const der = key.includes("BEGIN")
        ? Uint8Array.from(
              atob(key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")),
              (c) => c.charCodeAt(0),
          )
        : hexToBytes(key);
    // The point is the tail of the SubjectPublicKeyInfo: 33 bytes
    // compressed, 65 uncompressed.
    const tail = der.length >= 65 + 23 ? der.subarray(-65) : der.subarray(-33);
    try {
        return secp256k1.ProjectivePoint.fromHex(bytesToHex(tail)).toHex(true);
    } catch {
        return bytesToHex(der);
    }
};

export const sameKey = (a: string, b: string) => pointOf(a) === pointOf(b);

type RawKey = { key: string; seq: string | number };
const chainKey = (raw: RawKey): ChainKey => ({ key: raw.key, seq: BigInt(String(raw.seq)) });

const toRecord = (raw: any): ChainRecord => ({
    account: raw.account,
    owner: chainKey(raw.owner),
    active: chainKey(raw.active),
    partner: raw.partner || undefined,
    state: String(raw.state).toLowerCase() as ChainRecord["state"],
    stateUntil: raw.stateUntil ? new Date(raw.stateUntil) : undefined,
    pauseSeconds: Number(raw.pauseSeconds),
    freezeSeconds: Number(raw.freezeSeconds),
    pending: raw.pending
        ? {
              kind: raw.pending.kind,
              owner: raw.pending.owner ? chainKey(raw.pending.owner) : undefined,
              partner: raw.pending.partner || undefined,
              pauseSeconds: raw.pending.pauseSeconds ?? undefined,
              freezeSeconds: raw.pending.freezeSeconds ?? undefined,
          }
        : undefined,
    recoveryRequests: (raw.recoveryRequests ?? []).map(
        (r: { id: number; owner: RawKey; active: RawKey }) => ({
            id: Number(r.id),
            owner: chainKey(r.owner),
            active: chainKey(r.active),
        }),
    ),
});

/** The account's record as of the current block, or nothing if there is no such key-controlled account. */
export const fetchRecord = async (
    authOrigin: string,
    name: string,
    token?: string,
): Promise<ChainRecord | undefined> => {
    const res = await fetch(`${authOrigin}/graphql`, {
        method: "POST",
        headers: {
            "Content-Type": "application/graphql",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: `{ account(name: ${JSON.stringify(name)}) { ${RECORD_FIELDS} } }`,
    });
    if (!res.ok) throw new Error("Could not read the account.");
    const reply = (await res.json()) as {
        data?: { account?: unknown };
        errors?: { message: string }[];
    };
    if (reply.errors?.length) throw new Error(reply.errors[0].message);
    return reply.data?.account ? toRecord(reply.data.account) : undefined;
};

// ------------------------------------------------- passkey -> accounts

export interface Network {
    siblingOrigin: (service: string) => string;
    /** The guest session token, for requests the node wants identified. */
    token: string;
}

export const listStore = (net: Network, unlocked: Unlocked): ListStore => ({
    origin: net.siblingOrigin("x-signup"),
    locator: listLocator(unlocked.chainId, unlocked.root),
    key: listKey(unlocked.chainId, unlocked.root),
});

/**
 * The keys of `name` under this passkey, derived with the sequence values the
 * chain holds, or nothing if the account's owner key is not one this passkey
 * produces (it belongs to another passkey, or does not exist).
 */
export const keysFor = async (
    net: Network,
    unlocked: Unlocked,
    name: string,
): Promise<{ keys: AccountKeys; record: ChainRecord } | undefined> => {
    const record = await fetchRecord(net.siblingOrigin("auth-sig"), name, net.token);
    if (!record) return undefined;
    const keys = accountKeys(
        unlocked.chainId,
        unlocked.root,
        name,
        record.owner.seq,
        record.active.seq,
    );
    if (!sameKey(keys.owner.key, record.owner.key)) {
        keys.ownerSecret.fill(0);
        return undefined;
    }
    return { keys, record };
};

/**
 * Makes sure the account will be found from the passkey alone. The passkey
 * itself is the first place (it was written in the prompt that `unlocked`
 * came from, if the passkey can carry notes); the node's encrypted list is
 * used when it is not.
 */
export const recordAccount = async (
    net: Network,
    unlocked: Unlocked,
    entry: ListedAccount,
) => {
    if (unlocked.notesWritten) return;
    await updateList(listStore(net, unlocked), unlocked.guest, (accounts) =>
        withAccount(accounts, entry),
    );
};

/**
 * Brings this browser up to date with the passkey's account list: every
 * listed account whose key this browser does not hold yet has its active key
 * derived and put in the supervisor's key store. Returns the names usable
 * here afterwards.
 */
export const syncAccounts = async (
    net: Network,
    unlocked: Unlocked,
    app: string,
): Promise<string[]> => {
    // The passkey's own notes first; the node's list for a passkey that
    // carries none. Sequence values always come from the chain.
    const carried = unlocked.notes?.accounts ?? [];
    const names = carried.length
        ? carried
        : (await fetchList(listStore(net, unlocked))).accounts.map((a) => a.name);
    notePasskey({ userId: unlocked.userId, displayName: unlocked.notes?.displayName });
    const device = loadDevice();
    for (const entry of names.map((name) => ({ name }))) {
        const found = await keysFor(net, unlocked, entry.name).catch(() => undefined);
        if (!found) continue; // No longer this passkey's account.
        found.keys.ownerSecret.fill(0);
        const here = device.accounts.find((a) => a.name === entry.name);
        const upToDate =
            here &&
            here.held !== false &&
            here.ownerSeq === found.keys.owner.seq &&
            here.activeSeq === found.keys.active.seq;
        if (!upToDate) {
            if (found.record.state !== "normal") {
                // A paused or frozen account cannot sign in; keep its name
                // so it can be managed.
                rememberOnDevice(
                    { name: entry.name, ownerSeq: found.keys.owner.seq, activeSeq: found.keys.active.seq },
                    false,
                    false,
                );
                continue;
            }
            await adoptFor(app, entry.name, found.keys.activePem);
            rememberOnDevice(
                { name: entry.name, ownerSeq: found.keys.owner.seq, activeSeq: found.keys.active.seq },
                false,
            );
        }
    }
    return loadDevice().accounts.map((a) => a.name);
};
