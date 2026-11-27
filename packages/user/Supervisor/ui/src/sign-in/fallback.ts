// Passkeys that cannot produce a secret (no PRF extension).
//
// Some passkey providers sign but will not derive a secret: Chrome on Linux,
// and Chrome on macOS when Google's password manager holds the passkey. For
// those the page makes the secret from two things kept in two places
// (gofractally/psibase#2275):
//
//   passkey value  es256:          the passkey's P-256 public key (33 bytes,
//                                  compressed), recovered from its signature
//                  credential-id:  the credential id, for a passkey whose
//                                  key cannot be recovered from a signature
//                                  (RSA)
//   recovery key   32 random bytes, saved as a base58 (WIF) string in the
//                  password manager
//
//   secret = HMAC-SHA-256( key = recovery key, message = tag(kind) || passkey value )
//
// (a keyed hash, so the variable-length credential id needs no framing)
//
// and the secret is used exactly as a PRF output would be. The kind follows
// from the passkey itself, so it never has to be guessed: its algorithm at
// registration, and afterwards whether its signature is a recoverable ECDSA
// signature.
//
// This is weaker than PRF and the page says so. Neither passkey value is a
// secret (a public key, an identifier); what protects the account is the
// recovery key, with the passkey adding proof that its holder is present.
import { secp256k1 } from "@noble/curves/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils";

import {
    WebauthnSignatureError,
    looksLikeWif,
    pickP256PublicKey,
    recoverP256PublicKeys,
    wifDecode,
    wifEncode,
} from "@psibase/common-lib";

export type FallbackKind = "es256" | "credential-id";

const TAG: Record<FallbackKind, Uint8Array> = {
    es256: utf8ToBytes("psibase/passkey-fallback/es256/v1"),
    "credential-id": utf8ToBytes("psibase/passkey-fallback/credential-id/v1"),
};

export interface Assertion {
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
}

/** What a passkey without PRF gave the page. */
export interface NoPrfEvidence {
    credentialId: Uint8Array;
    /** Set when the passkey was just made. */
    registration?: { publicKey?: Uint8Array; algorithm?: number; label: string };
    /** Set when an existing passkey was used. */
    assertion?: Assertion;
    /** Uses the passkey once more (for telling its two candidate keys apart). */
    again: () => Promise<Assertion>;
}

/** The screens this needs; the page supplies them. */
export interface FallbackUi {
    /** Shows a new recovery key and resolves once the holder has kept it. */
    keep: (key: { wif: string; account: string }) => Promise<void>;
    /** Asks for the recovery key; resolves with what was typed or filled in. */
    ask: () => Promise<string>;
}

const equal = (a: Uint8Array, b: Uint8Array) => bytesToHex(a) === bytesToHex(b);

const candidates = (a: Assertion): Uint8Array[] | undefined => {
    try {
        return recoverP256PublicKeys(a.authenticatorData, a.clientDataJSON, a.signature);
    } catch (e) {
        if (e instanceof WebauthnSignatureError) return undefined;
        throw e;
    }
};

// ------------------------------------------------- where the key is kept

type PasswordCredentialLike = { type: string; id: string; password?: string };
type PasswordCredentialCtor = new (data: {
    id: string;
    password: string;
    name?: string;
}) => Credential;

const passwordApi = (): PasswordCredentialCtor | undefined =>
    (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;

// A signature gives two candidate keys, in an order that changes from one
// signature to the next, so "the first" or "the second" means nothing. The
// recovery key itself says which is real: it is chosen so that a keyed hash of
// the real key starts with 16 zero bits (see newRecoveryKey). Nothing has to
// be written beside it, so the password entry's user name is just the name.
const WHICH_TAG = utf8ToBytes("psibase/passkey-fallback/which/v1");

const marksAsReal = (recoveryKey: Uint8Array, key: Uint8Array) => {
    const h = hmac(sha256, recoveryKey, concatBytes(WHICH_TAG, key));
    return h[0] === 0 && h[1] === 0;
};

// Before that, the real key was remembered by 16 bits of its hash, written
// after the name in the password entry ("name+k3fa9") and in this device's
// hint. Entries saved that way are still read; none are written.
const fingerprint = (key: Uint8Array) => bytesToHex(sha256(key)).slice(0, 4);

const markFrom = (id: string): string | undefined => /\+k([0-9a-f]{4})$/.exec(id)?.[1];

const HINT_KEY = "psibase.passkey-fallback.v1";

interface Hint {
    kind: FallbackKind;
    /** Fingerprint of the passkey's real key, for an es256 passkey. */
    mark?: string;
}

const loadHint = (credentialId: Uint8Array): Hint | undefined => {
    try {
        const all = JSON.parse(window.localStorage.getItem(HINT_KEY) ?? "{}") as Record<string, Hint>;
        return all[bytesToHex(credentialId)];
    } catch {
        return undefined;
    }
};

const saveHint = (credentialId: Uint8Array, hint: Hint) => {
    try {
        const all = JSON.parse(window.localStorage.getItem(HINT_KEY) ?? "{}") as Record<string, Hint>;
        all[bytesToHex(credentialId)] = hint;
        window.localStorage.setItem(HINT_KEY, JSON.stringify(all));
    } catch {
        // Only a convenience.
    }
};

/** Offers the recovery key to the browser's password manager, where it has one. */
const offerToPasswordManager = async (account: string, wif: string) => {
    const Ctor = passwordApi();
    if (!Ctor) return;
    try {
        await navigator.credentials.store(
            new Ctor({
                id: account,
                password: wif,
                name: "Recovery secret (not a signing key)",
            }),
        );
    } catch (e) {
        console.warn("The password manager did not take the recovery key", e);
    }
};

/** The recovery key from the password manager, if it will give one. */
const fromPasswordManager = async (): Promise<{ wif: string; mark?: string } | undefined> => {
    if (!passwordApi()) return undefined;
    try {
        const found = (await navigator.credentials.get({
            password: true,
            mediation: "optional",
        } as CredentialRequestOptions)) as PasswordCredentialLike | null;
        if (found?.type === "password" && found.password && looksLikeWif(found.password)) {
            return { wif: found.password, mark: markFrom(found.id) };
        }
    } catch (e) {
        console.warn("The password manager gave no recovery key", e);
    }
    return undefined;
};

// --------------------------------------------------------------- the secret

const combine = (kind: FallbackKind, value: Uint8Array, recoveryKey: Uint8Array) =>
    hmac(sha256, recoveryKey, concatBytes(TAG[kind], value));

/**
 * A fresh recovery key: hash( the passkey's first signature || random bytes ||
 * counter ). The random bytes are what make it unguessable; they are used
 * here and kept nowhere. The counter runs until the key is a valid key of the
 * curve the saved format is for and, for a passkey whose key is recovered
 * from signatures, until it marks that key as the real one (about 65,000
 * tries, once).
 */
const newRecoveryKey = (mixIn: Uint8Array, realKey?: Uint8Array): Uint8Array => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const counter = new Uint8Array(4);
    const view = new DataView(counter.buffer);
    for (let n = 0; ; n = (n + 1) >>> 0) {
        view.setUint32(0, n, true);
        const candidate = sha256(concatBytes(mixIn, seed, counter));
        if (!secp256k1.utils.isValidPrivateKey(candidate)) continue;
        if (realKey && !marksAsReal(candidate, realKey)) continue;
        seed.fill(0);
        return candidate;
    }
};

/**
 * The secret for a passkey without PRF: makes and saves a recovery key for a
 * new passkey, or asks for the saved one for an existing passkey.
 */
export const secretWithoutPrf = async (ev: NoPrfEvidence, ui: FallbackUi): Promise<Uint8Array> => {
    if (ev.registration) {
        const es256 = ev.registration.algorithm === -7 && !!ev.registration.publicKey;
        const kind: FallbackKind = es256 ? "es256" : "credential-id";
        // The passkey is used once straight away. Its signature goes into
        // the recovery key, and for an ES256 passkey it shows that the key
        // can be recovered from a signature and which candidate it is. A
        // passkey that says ES256 but whose signature cannot be read back
        // must not quietly become a credential-id account: every later
        // sign-in would then derive something else.
        const first = await ev.again();
        let value = ev.credentialId;
        if (es256) {
            const found = candidates(first);
            const real = found && pickP256PublicKey(found, ev.registration.publicKey!);
            if (!found || !real) {
                throw new Error(
                    "This passkey signs in a form this page cannot read its key back from, so it cannot be used here without the secret-deriving (PRF) feature.",
                );
            }
            value = real;
        }
        const recoveryKey = newRecoveryKey(first.signature, es256 ? value : undefined);
        const wif = wifEncode(recoveryKey);
        await offerToPasswordManager(ev.registration.label, wif);
        await ui.keep({ wif, account: ev.registration.label });
        saveHint(ev.credentialId, { kind, mark: es256 ? fingerprint(value) : undefined });
        const secret = combine(kind, value, recoveryKey);
        recoveryKey.fill(0);
        return secret;
    }

    const assertion = ev.assertion!;
    const first = candidates(assertion);
    const kind: FallbackKind = first ? "es256" : "credential-id";

    const stored = await fromPasswordManager();
    const text = stored?.wif ?? (await ui.ask());
    const { secret: recoveryKey } = wifDecode(text.trim());

    let value = ev.credentialId;
    if (first) {
        // An earlier record of the real key, where there is one, then the
        // recovery key's own mark.
        const mark = stored?.mark ?? loadHint(ev.credentialId)?.mark;
        let real = mark ? first.filter((k) => fingerprint(k) === mark) : [];
        if (real.length !== 1) real = first.filter((k) => marksAsReal(recoveryKey, k));
        if (real.length !== 1) {
            // Neither settles it (a recovery key made before keys carried the
            // mark, or the rare case where both candidates carry it): a
            // second signature does, since only the real key is a candidate
            // of both.
            const second = candidates(await ev.again()) ?? [];
            real = first.filter((k) => second.some((s) => equal(s, k)));
            if (real.length !== 1) {
                throw new Error("That passkey gave two signatures that do not agree.");
            }
        }
        value = real[0];
        saveHint(ev.credentialId, { kind, mark: fingerprint(value) });
    } else {
        saveHint(ev.credentialId, { kind });
    }
    const secret = combine(kind, value, recoveryKey);
    recoveryKey.fill(0);
    return secret;
};
