// A secp256k1 private key as one line of text: Bitcoin's wallet import
// format (WIF), the string that Bitcoin tools read and write.
//
//    base58( version || secret[32] || [0x01] || check[4] )
//
// - version is 0x80 (mainnet) or 0xEF (Bitcoin's test networks). The key is
//   the same number either way; the byte only says where the string came
//   from.
// - A trailing 0x01 says that the public key is used in its compressed form
//   (strings that start with K or L; c on a test network). Without it the
//   public key is the uncompressed point (5; 9 on a test network).
// - check is the first four bytes of SHA-256(SHA-256(everything before it)).
//
// This mirrors psibase/wif.hpp, which is the definition; the two must
// agree, and both are tested against
// libraries/psibase/common/tests/wif-vectors.json.
//
// P-256 keys have no such form; they stay PEM.
import hashJs from "hash.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// No string of 37 or 38 bytes is longer than this in base58
const MAX_TEXT = 52;

// The order of the secp256k1 group
const ORDER =
    0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** The version byte of a WIF string: 0x80 or 0xEF */
export type WifNetwork = "mainnet" | "testnet";

/** What a WIF string holds */
export interface WifKey {
    /** The private key, big-endian. 0 < secret < the group order. */
    secret: Uint8Array;
    /** Whether the string asks for the compressed public key */
    compressed: boolean;
    network: WifNetwork;
}

/** The first rule that a string breaks, in the order they are checked */
export type WifErrorName =
    | "bad-character"
    | "bad-length"
    | "bad-checksum"
    | "bad-version"
    | "bad-flag"
    | "bad-secret";

const messages: Record<WifErrorName, string> = {
    "bad-character":
        "private key (WIF): contains a character that is not base58",
    "bad-length": "private key (WIF): wrong length",
    "bad-checksum": "private key (WIF): check digits do not match",
    "bad-version":
        "private key (WIF): not a Bitcoin mainnet or testnet private key",
    "bad-flag": "private key (WIF): malformed compression flag",
    "bad-secret": "private key (WIF): not a valid secp256k1 key",
};

/** Thrown by wifDecode and wifEncode. `reason` is the same name in every language. */
export class WifError extends Error {
    reason: WifErrorName;
    constructor(reason: WifErrorName) {
        super(messages[reason]);
        this.name = "WifError";
        this.reason = reason;
    }
}

const checkBytes = (payload: Uint8Array): number[] =>
    hashJs
        .sha256()
        .update(hashJs.sha256().update(payload).digest())
        .digest()
        .slice(0, 4);

const toBig = (bytes: Uint8Array): bigint => {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
};

// 0 < secret < order
const validSecret = (secret: Uint8Array): boolean => {
    const n = toBig(secret);
    return n > 0n && n < ORDER;
};

// ASCII white space at the ends: space, tab, CR, LF. Nothing else.
const trim = (text: string): string => text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

/**
 * The WIF string of a private key. Throws WifError("bad-secret") if the key
 * is not 32 bytes, is 0, or is not below the group order.
 */
export function wifEncode(
    secret: Uint8Array,
    compressed: boolean = true,
    network: WifNetwork = "mainnet",
): string {
    if (secret.length !== 32 || !validSecret(secret)) {
        throw new WifError("bad-secret");
    }
    const payload = Uint8Array.from([
        network === "mainnet" ? 0x80 : 0xef,
        ...secret,
        ...(compressed ? [0x01] : []),
    ]);
    let n = toBig(Uint8Array.from([...payload, ...checkBytes(payload)]));
    payload.fill(0);
    // The version byte is never zero, so there are no leading zeros to write
    let out = "";
    while (n > 0n) {
        out = ALPHABET[Number(n % 58n)] + out;
        n /= 58n;
    }
    return out;
}

/**
 * Reads a WIF string. ASCII white space (space, tab, CR, LF) is ignored at
 * the ends and is an error anywhere else. Throws WifError when the string
 * breaks one of the rules.
 */
export function wifDecode(text: string): WifKey {
    text = trim(text);
    let n = 0n;
    for (const ch of text) {
        const digit = ALPHABET.indexOf(ch);
        if (digit < 0 || ch.length !== 1) throw new WifError("bad-character");
        if (text.length <= MAX_TEXT) n = n * 58n + BigInt(digit);
    }
    if (text.length === 0 || text.length > MAX_TEXT) {
        throw new WifError("bad-length");
    }
    // The bytes are the number without its leading zeros, preceded by one
    // zero byte for each leading '1' of the text
    const body: number[] = [];
    for (; n > 0n; n >>= 8n) body.unshift(Number(n & 0xffn));
    let zeros = 0;
    while (zeros < text.length && text[zeros] === "1") ++zeros;
    const bytes = Uint8Array.from([...new Array(zeros).fill(0), ...body]);
    body.fill(0);
    try {
        if (bytes.length !== 37 && bytes.length !== 38) {
            throw new WifError("bad-length");
        }
        const payload = bytes.subarray(0, bytes.length - 4);
        const check = bytes.subarray(bytes.length - 4);
        if (!checkBytes(payload).every((b, i) => b === check[i])) {
            throw new WifError("bad-checksum");
        }
        if (payload[0] !== 0x80 && payload[0] !== 0xef) {
            throw new WifError("bad-version");
        }
        if (payload.length === 34 && payload[33] !== 0x01) {
            throw new WifError("bad-flag");
        }
        const secret = payload.slice(1, 33);
        if (!validSecret(secret)) throw new WifError("bad-secret");
        return {
            secret,
            compressed: payload.length === 34,
            network: payload[0] === 0x80 ? "mainnet" : "testnet",
        };
    } finally {
        bytes.fill(0);
    }
}

/**
 * Whether the text has the shape of a WIF string: 51 or 52 base58 characters
 * that start with 5, K, L, 9 or c, with optional white space around them.
 * Cheap, and says nothing about whether the string is valid; it is for
 * telling a key from a file name or a PEM document.
 */
export function looksLikeWif(text: string): boolean {
    return /^[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trim(text));
}
