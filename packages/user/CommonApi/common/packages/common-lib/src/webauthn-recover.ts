// The public key of a passkey, recovered from one of its assertions.
//
// A WebAuthn ES256 assertion is an ECDSA P-256 / SHA-256 signature over
//
//    authenticatorData || SHA-256(clientDataJSON)
//
// returned in DER: SEQUENCE { INTEGER r, INTEGER s }. Both parts of the
// message come back with the assertion, so the key that signed can be
// computed from it. The signature carries no recovery id, so the result is
// a short list of candidates: two, or (about once in 2^128) up to four.
//
// EVERY candidate verifies the signature; that is what recovery means.
// Verification therefore cannot tell which one is the passkey's. What can:
//  - a key known from elsewhere (pickP256PublicKey), e.g. the one that
//    registration returned;
//  - a second assertion by the same passkey: the two candidate lists have
//    exactly the real key in common;
//  - trying each candidate against whatever the key is used to derive.
//
// Low-S is not required. WebAuthn does not ask authenticators for it, and
// about half of real signatures have s > n/2; they are accepted here, both
// for recovery and for verification. (This is unlike verify-sig on chain,
// which takes only low-S: see signatureToBin in key-conversions.ts.)
//
// Works for ES256 (COSE algorithm -7) only. RSA and EdDSA passkeys do not
// allow recovery.
//
// Tested against libraries/psibase/common/tests/webauthn-p256-vectors.json,
// which Node's built-in crypto wrote (webauthn-p256-vectors.mjs beside it).
import elliptic from "elliptic";
import hashJs from "hash.js";

/** The first rule that a signature breaks, in the order they are checked */
export type WebauthnSignatureErrorName =
    | "bad-der"
    | "out-of-range"
    | "not-recoverable";

/** Thrown by recoverP256PublicKeys */
export class WebauthnSignatureError extends Error {
    reason: WebauthnSignatureErrorName;
    constructor(reason: WebauthnSignatureErrorName, detail: string) {
        super(`WebAuthn signature: ${detail}`);
        this.name = "WebauthnSignatureError";
        this.reason = reason;
    }
}

type Point = elliptic.curve.base.BasePoint;

// The order of the P-256 group
const ORDER =
    0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
// The prime of the P-256 field
const PRIME =
    0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;

// DER SubjectPublicKeyInfo for P-256 up to the point itself:
// SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING { 0 unused
// bits, point } }, for an uncompressed (65 byte) and a compressed (33 byte)
// point.
const SPKI_UNCOMPRESSED = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00,
];
const SPKI_COMPRESSED = [
    0x30, 0x39, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x22, 0x00,
];

let p256: elliptic.ec | undefined = undefined;
const curve = (): elliptic.ec => (p256 ??= new elliptic.ec("p256"));

const toBig = (bytes: Uint8Array): bigint => {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
};

const toHex = (n: bigint): string => n.toString(16).padStart(64, "0");

const sha256 = (bytes: Uint8Array): number[] =>
    hashJs.sha256().update(Array.from(bytes)).digest() as number[];

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean =>
    prefix.every((b, i) => bytes[i] === b);

const bad = (detail: string) => new WebauthnSignatureError("bad-der", detail);

// One DER INTEGER at `at`: positive, in the fewest bytes, at most 33 of them.
// Returns the number and the position after it.
function derInteger(
    der: Uint8Array,
    at: number,
    end: number,
    name: string,
): [bigint, number] {
    if (end - at < 2) throw bad(`cut short before ${name}`);
    if (der[at] !== 0x02) throw bad(`${name} is not an INTEGER`);
    const length = der[at + 1];
    if (length === 0) throw bad(`${name} is empty`);
    // 32 bytes, and one zero in front when the top bit is set
    if (length > 33) throw bad(`${name} is longer than 33 bytes`);
    const start = at + 2;
    if (start + length > end) throw bad(`cut short inside ${name}`);
    if (der[start] & 0x80) throw bad(`${name} is negative`);
    if (length > 1 && der[start] === 0 && !(der[start + 1] & 0x80)) {
        throw bad(`${name} has a zero byte in front that it does not need`);
    }
    return [toBig(der.subarray(start, start + length)), start + length];
}

// SEQUENCE { INTEGER r, INTEGER s }, strictly: nothing before, between or
// after, every length in its shortest form. Then 0 < r, s < n.
function parseSignature(der: Uint8Array): { r: bigint; s: bigint } {
    if (der.length < 2) throw bad("cut short");
    if (der[0] !== 0x30) throw bad("does not start with a SEQUENCE");
    // The longest P-256 signature is 70 bytes of content, so a length of 128
    // or more, or one written in the long form, is never right
    if (der[1] & 0x80) throw bad("length is not in its shortest form");
    if (2 + der[1] > der.length) throw bad("cut short");
    if (2 + der[1] < der.length) throw bad("bytes after the end");
    const [r, afterR] = derInteger(der, 2, der.length, "r");
    const [s, afterS] = derInteger(der, afterR, der.length, "s");
    if (afterS !== der.length) throw bad("bytes after s");
    for (const [name, value] of [
        ["r", r],
        ["s", s],
    ] as const) {
        if (value === 0n) {
            throw new WebauthnSignatureError("out-of-range", `${name} is 0`);
        }
        if (value >= ORDER) {
            throw new WebauthnSignatureError(
                "out-of-range",
                `${name} is not below the group order`,
            );
        }
    }
    return { r, s };
}

// A P-256 point from its compressed or uncompressed SEC1 form or from a DER
// SubjectPublicKeyInfo; undefined if the bytes are none of those or the
// point is not on the curve.
function parsePoint(bytes: Uint8Array): Point | undefined {
    let sec1 = bytes;
    if (bytes.length === 91 && startsWith(bytes, SPKI_UNCOMPRESSED)) {
        sec1 = bytes.subarray(26);
    } else if (bytes.length === 59 && startsWith(bytes, SPKI_COMPRESSED)) {
        sec1 = bytes.subarray(26);
    }
    const compressed =
        sec1.length === 33 && (sec1[0] === 0x02 || sec1[0] === 0x03);
    const uncompressed = sec1.length === 65 && sec1[0] === 0x04;
    if (!compressed && !uncompressed) return undefined;
    // Coordinates are field elements: below the prime
    if (toBig(sec1.subarray(1, 33)) >= PRIME) return undefined;
    if (uncompressed && toBig(sec1.subarray(33)) >= PRIME) return undefined;
    try {
        const point = curve().curve.decodePoint(Array.from(sec1));
        if (point.isInfinity() || !point.validate()) return undefined;
        return point;
    } catch {
        return undefined;
    }
}

const compress = (point: Point): Uint8Array =>
    Uint8Array.from(point.encode("array", true));

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The bytes that a WebAuthn assertion signs:
 * authenticatorData || SHA-256(clientDataJSON). Both arguments are the
 * fields of the AuthenticatorAssertionResponse, as bytes.
 */
export function webauthnSignedMessage(
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array,
): Uint8Array {
    const out = new Uint8Array(authenticatorData.length + 32);
    out.set(authenticatorData);
    out.set(sha256(clientDataJSON), authenticatorData.length);
    return out;
}

/**
 * Every P-256 public key that could have made an ES256 assertion, each as a
 * 33-byte compressed SEC1 point.
 *
 * The order is fixed: by recovery id, ascending. Id 0 is the key for which
 * the signer's ephemeral point had x = r and an even y, id 1 the same x and
 * an odd y; ids 2 and 3 are the same for x = r + n, which exists only when
 * r < p - n (about once in 2^128). So the result has two keys in practice,
 * never more than four, and never the same key twice.
 *
 * Every key returned verifies the signature (verifyWebauthnP256 is true for
 * each); one of them is the passkey's. Use pickP256PublicKey, or a second
 * assertion, to tell which.
 *
 * `signatureDer` is read strictly: SEQUENCE { INTEGER r, INTEGER s } and
 * nothing else, shortest lengths, positive integers without a needless zero
 * in front. Signatures with s > n/2 are accepted: WebAuthn does not require
 * low-S.
 *
 * Throws WebauthnSignatureError with `reason`:
 *  - "bad-der": the signature is not that DER;
 *  - "out-of-range": r or s is 0 or not below the group order;
 *  - "not-recoverable": no point of the curve has x = r, so no key made this
 *    signature (a real signature never does this).
 */
export function recoverP256PublicKeys(
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array,
    signatureDer: Uint8Array,
): Uint8Array[] {
    const { r, s } = parseSignature(signatureDer);
    const digest = sha256(
        webauthnSignedMessage(authenticatorData, clientDataJSON),
    );
    const signature = { r: toHex(r), s: toHex(s) };
    // x = r + n is a field element only when it is below the prime
    const ids = r + ORDER < PRIME ? [0, 1, 2, 3] : [0, 1];
    const keys: Uint8Array[] = [];
    for (const id of ids) {
        let point: Point;
        try {
            point = curve().recoverPubKey(digest, signature, id);
        } catch {
            continue; // no point with this x
        }
        if (point.isInfinity() || !point.validate()) continue;
        const key = compress(point);
        if (!keys.some((k) => sameBytes(k, key))) keys.push(key);
    }
    if (keys.length === 0) {
        throw new WebauthnSignatureError(
            "not-recoverable",
            "r is not the x coordinate of a point of the curve",
        );
    }
    return keys;
}

/**
 * The candidate that is the same key as `known`, or undefined if none is.
 *
 * `known` is a P-256 public key as a compressed (33 bytes) or uncompressed
 * (65 bytes) SEC1 point or as a DER SubjectPublicKeyInfo (what
 * AuthenticatorAttestationResponse.getPublicKey() returns). Keys are
 * compared as points, so the encodings need not match. Also undefined when
 * `known` is not a P-256 public key in one of those forms.
 */
export function pickP256PublicKey(
    candidates: Uint8Array[],
    known: Uint8Array,
): Uint8Array | undefined {
    const point = parsePoint(known);
    if (!point) return undefined;
    const wanted = compress(point);
    return candidates.find((candidate) => {
        const p = parsePoint(candidate);
        return p !== undefined && sameBytes(compress(p), wanted);
    });
}

/**
 * Whether `signatureDer` is `publicKey`'s ES256 signature of the assertion.
 * `publicKey` is in any of the forms pickP256PublicKey takes.
 *
 * Signatures with s > n/2 are accepted, because WebAuthn does not require
 * low-S. False, not an exception, for a malformed signature or a
 * `publicKey` that is not a P-256 key.
 *
 * True for every key recoverP256PublicKeys returns, not just the passkey's.
 */
export function verifyWebauthnP256(
    publicKey: Uint8Array,
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array,
    signatureDer: Uint8Array,
): boolean {
    const point = parsePoint(publicKey);
    if (!point) return false;
    let signature;
    try {
        const { r, s } = parseSignature(signatureDer);
        signature = { r: toHex(r), s: toHex(s) };
    } catch {
        return false;
    }
    const digest = sha256(
        webauthnSignedMessage(authenticatorData, clientDataJSON),
    );
    return curve().verify(
        digest,
        signature,
        curve().keyFromPublic(point.encode("hex", false), "hex"),
    );
}
