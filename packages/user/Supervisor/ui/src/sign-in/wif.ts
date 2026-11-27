// A secp256k1 private key as one line of text: Bitcoin's wallet import
// format (WIF), which is what people who have handled such a key expect.
//
//   base58check( 0x80 || secret[32] || 0x01 )
//
// 0x80 is the mainnet version byte and the trailing 0x01 says the public key
// is used in its compressed form, which is the form accounts store. The
// string starts with K or L. Reading also accepts the older form without
// the 0x01 (it starts with 5), and the test-network version byte 0xEF
// (strings starting with c or 9): wallets on Bitcoin's test networks write
// that, and the key is the same number. The four check bytes are the start of
// SHA-256(SHA-256(payload)), so a mistyped string is refused.
//
// The same string is understood by Bitcoin tools. That is deliberate for
// keys used with the bridge; it also means the key is only as safe as every
// place it is pasted.
import { sha256 } from "@noble/hashes/sha256";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const base58 = (bytes: Uint8Array): string => {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let out = "";
    while (n > 0n) {
        out = ALPHABET[Number(n % 58n)] + out;
        n /= 58n;
    }
    for (const b of bytes) {
        if (b !== 0) break;
        out = "1" + out;
    }
    return out;
};

const unbase58 = (text: string): Uint8Array | undefined => {
    let n = 0n;
    for (const ch of text) {
        const i = ALPHABET.indexOf(ch);
        if (i < 0) return undefined;
        n = n * 58n + BigInt(i);
    }
    const body: number[] = [];
    while (n > 0n) {
        body.unshift(Number(n & 0xffn));
        n >>= 8n;
    }
    let zeros = 0;
    for (const ch of text) {
        if (ch !== "1") break;
        ++zeros;
    }
    return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
};

const checksum = (payload: Uint8Array) => sha256(sha256(payload)).subarray(0, 4);

/** The key as a WIF string (compressed public key). */
export const toWif = (secret: Uint8Array): string => {
    if (secret.length !== 32) throw new Error("private key must be 32 bytes");
    const payload = Uint8Array.from([0x80, ...secret, 0x01]);
    return base58(Uint8Array.from([...payload, ...checksum(payload)]));
};

/** Whether the text has the shape of a WIF string (not whether it is valid). */
export const looksLikeWif = (text: string): boolean =>
    /^[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(text.trim());

/**
 * Reads a WIF string. `compressed` says which form of the public key the
 * string asks for.
 */
export const fromWif = (text: string): { secret: Uint8Array; compressed: boolean } => {
    const bytes = unbase58(text.trim());
    if (!bytes || (bytes.length !== 37 && bytes.length !== 38)) {
        throw new Error("That is not a private key in base58 form.");
    }
    const payload = bytes.subarray(0, bytes.length - 4);
    const check = bytes.subarray(bytes.length - 4);
    if (!checksum(payload).every((b, i) => b === check[i])) {
        throw new Error("That key has a mistake in it: its check digits do not match.");
    }
    if (payload[0] !== 0x80 && payload[0] !== 0xef) {
        throw new Error("That is not a private key in base58 form.");
    }
    const compressed = payload.length === 34;
    if (compressed && payload[33] !== 0x01) {
        throw new Error("That is not a private key in base58 form.");
    }
    return { secret: payload.slice(1, 33), compressed };
};
