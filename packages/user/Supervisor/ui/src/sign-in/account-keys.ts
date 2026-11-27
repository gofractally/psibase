// Key derivation for passkey accounts (gofractally/psibase#2275, section 4).
// Suite 2. Every input is fixed-width binary.
//
//   H(purpose, fields...) = SHA-256( u32le(2) || u8(purpose) || chainId[32] || fields... )
//
//   root          = H(1, prfOutput[32])
//   guest secret  = scalar(H(2, root[32], counter u8))
//   owner secret  = scalar(H(3, root[32], account u64le, ownerSeq u64le, counter u8))
//   active secret = scalar(H(4, ownerSecret[32], account u64le, activeSeq u64le, counter u8))
//   list locator  = H(5, root[32])        list key = H(6, root[32])
//
// scalar(): the 32 bytes as a big-endian integer d; the counter starts at 0
// and increases until 1 <= d < n (secp256k1), so every result is a valid
// private key. `account` is the account's binary number, not its name.
//
// The root and the owner secret exist only while a passkey prompt is being
// acted on. Nothing in this module stores anything.
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils";

export const SUITE = 2;

/** The PRF input is constant, so one passkey always gives one root per network. */
export const prfInput = (): Uint8Array =>
    utf8ToBytes("psibase/prf/application-key/v1");

const PURPOSE = {
    root: 1,
    guest: 2,
    owner: 3,
    active: 4,
    listLocator: 5,
    listKey: 6,
} as const;

const u32le = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return b;
};
const u64le = (v: bigint) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return b;
};
const need = (bytes: Uint8Array, n: number, what: string) => {
    if (!(bytes instanceof Uint8Array) || bytes.length !== n) {
        throw new Error(`${what} must be ${n} bytes`);
    }
    return bytes;
};

const H = (chainId: Uint8Array, purpose: number, ...fields: Uint8Array[]) =>
    sha256(
        concatBytes(
            u32le(SUITE),
            Uint8Array.of(purpose),
            need(chainId, 32, "chain id"),
            ...fields,
        ),
    );

const scalar = (chainId: Uint8Array, purpose: number, ...fields: Uint8Array[]) => {
    for (let counter = 0; counter < 256; ++counter) {
        const candidate = H(chainId, purpose, ...fields, Uint8Array.of(counter));
        const d = BigInt("0x" + bytesToHex(candidate));
        if (d >= 1n && d < secp256k1.CURVE.n) return candidate;
    }
    throw new Error("Key derivation failed");
};

export const rootFrom = (chainId: Uint8Array, prfOutput: Uint8Array) =>
    H(chainId, PURPOSE.root, need(prfOutput, 32, "passkey secret"));
export const guestSecret = (chainId: Uint8Array, root: Uint8Array) =>
    scalar(chainId, PURPOSE.guest, need(root, 32, "root"));
export const ownerSecret = (
    chainId: Uint8Array,
    root: Uint8Array,
    account: bigint,
    ownerSeq: bigint,
) =>
    scalar(
        chainId,
        PURPOSE.owner,
        need(root, 32, "root"),
        u64le(account),
        u64le(ownerSeq),
    );
export const activeSecret = (
    chainId: Uint8Array,
    owner: Uint8Array,
    account: bigint,
    activeSeq: bigint,
) =>
    scalar(
        chainId,
        PURPOSE.active,
        need(owner, 32, "owner secret"),
        u64le(account),
        u64le(activeSeq),
    );
export const listLocator = (chainId: Uint8Array, root: Uint8Array) =>
    H(chainId, PURPOSE.listLocator, need(root, 32, "root"));
export const listKey = (chainId: Uint8Array, root: Uint8Array) =>
    H(chainId, PURPOSE.listKey, need(root, 32, "root"));

// ------------------------------------------------- account name -> number
// As psibase::AccountNumber (NameEncoder<u64, 10>{36}): at most 10 characters.

const MAX_LEN = 10;
const REGULAR = 36n;
const tail = (() => {
    const t = [{ withSep: 1n, withoutSep: 0n }];
    for (let i = 1; i < MAX_LEN; ++i) {
        const withoutSep = REGULAR * t[i - 1].withSep;
        t.push({ withoutSep, withSep: t[i - 1].withoutSep + withoutSep + 1n });
    }
    return t;
})();
const charIndex = (ch: string): bigint => {
    if (ch === "-") return 0n;
    if (ch >= "0" && ch <= "9") return BigInt(ch.charCodeAt(0) - 48 + 1);
    if (ch >= "a" && ch <= "z") return BigInt(ch.charCodeAt(0) - 97 + 11);
    return -1n;
};

/** The account's binary number, or 0n if the name is not valid. */
export const accountNumber = (name: string): bigint => {
    let result = 0n;
    let maxlen = MAX_LEN;
    let allowsSep = false;
    let allowsEnd = true;
    for (const ch of name) {
        const idx = charIndex(ch);
        if (maxlen === 0 || idx < 0n || (idx === 0n && !allowsSep)) return 0n;
        if (allowsEnd) result += 1n;
        if (idx === 0n) {
            // A separator contributes nothing beyond its position.
        } else {
            result += (idx - 1n) * tail[maxlen - 1].withSep;
            if (allowsSep) result += tail[maxlen - 1].withoutSep;
        }
        allowsEnd = allowsSep = idx !== 0n;
        --maxlen;
    }
    if (!allowsEnd) return 0n;
    return result << 8n;
};

// ------------------------------------------------------------------ keys

// DER SubjectPublicKeyInfo header for a compressed secp256k1 point.
const SPKI_K1_COMPRESSED = Uint8Array.from([
    0x30, 0x36, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x22, 0x00,
]);

// PKCS#8 header for a secp256k1 private key with no public-key field.
const PKCS8_K1 = Uint8Array.from([
    0x30, 0x3e, 0x02, 0x01, 0x00, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x04,
    0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
]);

/** Hex DER SubjectPublicKeyInfo (compressed point) of a private key. */
export const publicKeyHex = (secret: Uint8Array): string =>
    bytesToHex(
        concatBytes(SPKI_K1_COMPRESSED, secp256k1.getPublicKey(secret, true)),
    );

/** A hex SubjectPublicKeyInfo as PEM text, the form the chain's services read in JSON. */
export const publicKeyPem = (spkiHex: string): string => {
    const b64 = btoa(String.fromCharCode(...hexToBytes(spkiHex)));
    return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----\n`;
};

/** A private key as a PKCS#8 PEM, for the supervisor's key store only. */
export const privateKeyPem = (secret: Uint8Array): string => {
    const der = concatBytes(PKCS8_K1, need(secret, 32, "private key"));
    const b64 = btoa(String.fromCharCode(...der));
    return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
};

// PKCS#8 for a secp256k1 key whose ECPrivateKey carries the public key, which
// the command-line tool requires:
//   SEQ { 0, SEQ { ecPublicKey, secp256k1 },
//         OCTET STRING { SEQ { 1, OCTET STRING key[32], [1] BIT STRING point[33] } } }
// The point is written compressed. A signer claims the public key in the form
// it finds in the file, and the chain compares that claim byte for byte with
// the stored key, which is the compressed form (publicKeyHex above).
const PKCS8_K1_FULL_HEAD = Uint8Array.from([
    0x30, 0x64, 0x02, 0x01, 0x00, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x04,
    0x4d, 0x30, 0x4b, 0x02, 0x01, 0x01, 0x04, 0x20,
]);
const PKCS8_K1_FULL_PUB = Uint8Array.from([0xa1, 0x24, 0x03, 0x22, 0x00]);

/**
 * A private key as a key file for use outside the browser: PKCS#8 PEM with
 * the public key included.
 */
export const exportedKeyPem = (secret: Uint8Array): string => {
    const der = concatBytes(
        PKCS8_K1_FULL_HEAD,
        need(secret, 32, "private key"),
        PKCS8_K1_FULL_PUB,
        secp256k1.getPublicKey(secret, true),
    );
    const b64 = btoa(String.fromCharCode(...der));
    return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
};

/** Signs a 32-byte digest; returns hex r || s, low-S. */
export const signDigest = (digest: Uint8Array, secret: Uint8Array): string =>
    secp256k1.sign(need(digest, 32, "digest"), secret, { lowS: true }).toCompactHex();

/** Signs sha256(utf8(message)). */
export const signText = (message: string, secret: Uint8Array): string =>
    signDigest(sha256(utf8ToBytes(message)), secret);

export const sha256Hex = (data: string | Uint8Array): string =>
    bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));

export const hexToBytes = (hex: string): Uint8Array =>
    Uint8Array.from(hex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));

export { bytesToHex };

/** The keys of one account, as the chain stores them. */
export interface KeySpec {
    key: string;
    seq: string;
}

export interface AccountKeys {
    owner: KeySpec;
    active: KeySpec;
    /** The owner private key. Use it and let it go; never store it. */
    ownerSecret: Uint8Array;
    /** The active private key, for the supervisor's key store. */
    activePem: string;
}

/** Both keys of `name` under `root`, or an error for a name with no number. */
export const accountKeys = (
    chainId: Uint8Array,
    root: Uint8Array,
    name: string,
    ownerSeq: bigint,
    activeSeq: bigint,
): AccountKeys => {
    const account = accountNumber(name);
    if (account === 0n) throw new Error(`${name} is not a valid account name.`);
    const owner = ownerSecret(chainId, root, account, ownerSeq);
    const active = activeSecret(chainId, owner, account, activeSeq);
    try {
        return {
            owner: { key: publicKeyHex(owner), seq: ownerSeq.toString() },
            active: { key: publicKeyHex(active), seq: activeSeq.toString() },
            ownerSecret: owner,
            activePem: privateKeyPem(active),
        };
    } finally {
        active.fill(0);
    }
};
