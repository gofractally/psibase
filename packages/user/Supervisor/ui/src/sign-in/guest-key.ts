// Derivation suite "psibase-app-key-k1-v1".
//
// The application key is derived from the passkey's PRF output. Nothing here
// depends on the WebAuthn challenge, the host name of the node, or anything
// else that changes between visits: the same passkey always gives the same
// key on the same network.
//
//   PRF input : utf8("psibase/prf/application-key/v1")
//   ikm       : PRF output (32 bytes)
//   salt      : utf8("psibase/hkdf/v1")
//   info      : utf8("application-key") || 0x00 || utf8(chainId) || 0x00 || counter
//   d         : HKDF-SHA-256(ikm, salt, info, 32) as a big-endian integer
//
// counter starts at 0 and increases by one until 1 <= d < n (secp256k1).
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils";

export const SUITE = "psibase-app-key-k1-v1";

export const prfInput = (): Uint8Array =>
    utf8ToBytes("psibase/prf/application-key/v1");

const HKDF_SALT = utf8ToBytes("psibase/hkdf/v1");

// DER SubjectPublicKeyInfo header for a compressed secp256k1 point.
const SPKI_K1_COMPRESSED = Uint8Array.from([
    0x30, 0x36, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x22, 0x00,
]);

const bytesToBigInt = (bytes: Uint8Array): bigint =>
    BigInt("0x" + bytesToHex(bytes));

export const derivePrivateKey = (
    prfOutput: Uint8Array,
    chainId: string,
): Uint8Array => {
    if (prfOutput.length !== 32) {
        throw new Error("Unexpected passkey secret length");
    }
    for (let counter = 0; counter < 256; ++counter) {
        const info = concatBytes(
            utf8ToBytes("application-key"),
            Uint8Array.of(0),
            utf8ToBytes(chainId),
            Uint8Array.of(0, counter),
        );
        const candidate = hkdf(sha256, prfOutput, HKDF_SALT, info, 32);
        const d = bytesToBigInt(candidate);
        if (d >= 1n && d < secp256k1.CURVE.n) return candidate;
    }
    throw new Error("Key derivation failed");
};

/** A signer that keeps the private key inside this module's closure. */
export interface GuestKey {
    /** Hex DER SubjectPublicKeyInfo (compressed point). */
    publicKey: string;
    /** Signs sha256(message); returns hex r || s, low-S. */
    sign(message: string): string;
}

export const guestKeyFrom = (
    prfOutput: Uint8Array,
    chainId: string,
): GuestKey => {
    const priv = derivePrivateKey(prfOutput, chainId);
    const point = secp256k1.getPublicKey(priv, true);
    const publicKey = bytesToHex(concatBytes(SPKI_K1_COMPRESSED, point));
    return {
        publicKey,
        sign: (message: string) =>
            secp256k1
                .sign(sha256(utf8ToBytes(message)), priv, { lowS: true })
                .toCompactHex(),
    };
};

// PKCS#8 header for a secp256k1 private key with no public-key field.
const PKCS8_K1 = Uint8Array.from([
    0x30, 0x3e, 0x02, 0x01, 0x00, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x04,
    0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
]);

/**
 * The private key as a PKCS#8 PEM, for the supervisor's own key store and
 * nothing else. The store is what signs the account's transactions once
 * the guest has become a named account.
 */
export const privateKeyPem = (
    prfOutput: Uint8Array,
    chainId: string,
): string => {
    const der = concatBytes(PKCS8_K1, derivePrivateKey(prfOutput, chainId));
    const b64 = btoa(String.fromCharCode(...der));
    return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
};

export const sha256Hex = (text: string): string =>
    bytesToHex(sha256(utf8ToBytes(text)));

export const hexToBytes = (hex: string): Uint8Array =>
    Uint8Array.from(hex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
