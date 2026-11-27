// The accounts this browser can use, and the calls into the supervisor's
// plugins that hold their active keys.
//
// What is kept here is public: account names and the sequence values their
// keys were derived with. The active private keys are in the supervisor's
// key store; owner keys are nowhere.
import { p256 } from "@noble/curves/p256";
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
    /**
     * "imported": the signing key was brought in from a key file, not made
     * by the passkey. It is kept in this browser only, and the passkey can
     * neither restore it elsewhere nor act as the account's owner.
     */
    source?: "imported";
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
    /**
     * Which account each app was entered as: an account name, or "" for a
     * guest. An app sees only the account chosen for it, so a visitor can
     * keep the accounts they use elsewhere to themselves.
     */
    apps?: Record<string, string>;
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
    source?: "imported",
) => {
    const device = loadDevice();
    saveDevice({
        ...device,
        accounts: withAccount(device.accounts, {
            ...entry,
            held,
            ...(source ? { source } : {}),
        } as DeviceEntry),
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

/**
 * The choice made for `app`: an account this browser can sign in as, "" for
 * a guest, or undefined when the visitor has not chosen yet.
 */
export const choiceFor = (app: string): string | undefined => {
    const device = loadDevice();
    const choice = device.apps?.[app];
    if (choice === undefined || choice === "") return choice;
    const entry = device.accounts.find((a) => a.name === choice);
    return entry && entry.held !== false ? choice : undefined;
};

export const rememberChoice = (app: string, account: string | undefined) => {
    const device = loadDevice();
    saveDevice({ ...device, apps: { ...device.apps, [app]: account ?? "" } });
};

/** The accounts this browser holds a signing key for. */
export const heldAccounts = (): string[] =>
    loadDevice()
        .accounts.filter((a) => a.held !== false)
        .map((a) => a.name);

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
    /** The service that verifies signatures made with the key. */
    verifier?: string;
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
    owner { key seq verifier } active { key seq verifier } partner
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
    // Either curve: the same bytes are normalised the same way on both
    // sides of a comparison.
    for (const curve of [secp256k1, p256]) {
        try {
            return curve.ProjectivePoint.fromHex(bytesToHex(tail)).toHex(true);
        } catch {
            // Not a point of this curve.
        }
    }
    return bytesToHex(der);
};

export const sameKey = (a: string, b: string) => pointOf(a) === pointOf(b);

type RawKey = { key: string; seq: string | number; verifier?: string };
const chainKey = (raw: RawKey): ChainKey => ({
    key: raw.key,
    seq: BigInt(String(raw.seq)),
    verifier: raw.verifier,
});

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
): Promise<{ keys: AccountKeys; record: ChainRecord; ownsIt: boolean } | undefined> => {
    const record = await fetchRecord(net.siblingOrigin("auth-sig"), name, net.token);
    if (!record) return undefined;
    const keys = accountKeys(
        unlocked.chainId,
        unlocked.root,
        name,
        record.owner.seq,
        record.active.seq,
    );
    if (sameKey(keys.owner.key, record.owner.key)) {
        return { keys, record, ownsIt: true };
    }
    // The owner key is someone else's (a key file kept offline, say), but
    // the account's signing key is this passkey's: its owner gave this
    // passkey the right to sign, and nothing more.
    keys.ownerSecret.fill(0);
    if (sameKey(keys.active.key, record.active.key)) {
        return { keys, record, ownsIt: false };
    }
    return undefined;
};

/**
 * The signing key this passkey would hold for `name` if the account's owner
 * installed it: the next unused sequence value, under the owner sequence
 * the chain has.
 */
export const signingKeyOffer = async (
    net: Network,
    unlocked: Unlocked,
    name: string,
): Promise<{ key: string; seq: string } | undefined> => {
    const record = await fetchRecord(net.siblingOrigin("auth-sig"), name, net.token);
    if (!record) return undefined;
    const seq = record.active.seq + 1n;
    const keys = accountKeys(unlocked.chainId, unlocked.root, name, record.owner.seq, seq);
    keys.ownerSecret.fill(0);
    return keys.active;
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
            // Signed in to the supervisor only: no app learns of an account
            // until the visitor chooses it for that app.
            await adoptFor("supervisor", entry.name, found.keys.activePem);
            rememberOnDevice(
                { name: entry.name, ownerSeq: found.keys.owner.seq, activeSeq: found.keys.active.seq },
                false,
            );
        }
    }
    // An account this browser remembers that is no longer on the network (or
    // is no longer this passkey's) is dropped, so it is not offered.
    for (const entry of loadDevice().accounts) {
        if (entry.source === "imported") {
            // Its key is not the passkey's; it stays for as long as the
            // account exists.
            const record = await fetchRecord(
                net.siblingOrigin("auth-sig"),
                entry.name,
                net.token,
            ).catch(() => "unknown" as const);
            if (!record) dropFromDevice(entry.name);
            continue;
        }
        const still = await keysFor(net, unlocked, entry.name).catch(() => "unknown" as const);
        if (still === "unknown") continue; // Could not ask; leave it.
        if (still) still.keys.ownerSecret.fill(0);
        else dropFromDevice(entry.name);
    }
    return loadDevice().accounts.map((a) => a.name);
};
