// A private key the visitor holds as a file, for an account that was not
// made with their passkey.
//
// Such a key has lived outside this browser and may still be in use there,
// so importing it never changes the account: the key is checked against the
// chain, then kept in the supervisor's key store like any signing key, and
// the account is marked as being on an imported key. The parsed secret
// exists here only while that happens.
import { p256 } from "@noble/curves/p256";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

import { WifError, looksLikeWif, wifDecode } from "@psibase/common-lib";

import { hexToBytes, privateKeyPem } from "./account-keys";

export type Curve = "secp256k1" | "secp256r1";

export interface PastedKey {
    curve: Curve;
    secret: Uint8Array;
    /** The public key as a compressed point, hex. */
    point: string;
    /** PKCS#8 PEM for the supervisor's key store. */
    pem: string;
}

const OID_K1 = "2b8104000a";
const OID_R1 = "2a8648ce3d030107";

const curves = { secp256k1, secp256r1: p256 } as const;

/**
 * Reads a private key as people hold one: a base58 string (secp256k1), or a
 * PEM file (PKCS#8, or SEC1 "EC PRIVATE KEY" for secp256k1).
 */
export const parsePrivateKey = (text: string): PastedKey => {
    // A secp256k1 key in Bitcoin's wallet import format: K... or L..., or the
    // older 5..., or c.../9... from a wallet on one of Bitcoin's test
    // networks. The format is common-lib's (psibase/wif.hpp).
    const pasted = text.trim();
    if (looksLikeWif(pasted)) {
        let secret: Uint8Array;
        try {
            ({ secret } = wifDecode(pasted));
        } catch (e) {
            throw new Error(
                e instanceof WifError && e.reason === "bad-checksum"
                    ? "That key has a mistake in it: its check digits do not match."
                    : "That is not a private key in base58 form.",
            );
        }
        return {
            curve: "secp256k1",
            secret,
            point: bytesToHex(secp256k1.getPublicKey(secret, true)),
            pem: privateKeyPem(secret),
        };
    }
    const armor = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(text);
    if (!armor) {
        throw new Error(
            "That is not a private key. Paste the key's base58 string, or the whole key file including its BEGIN and END lines.",
        );
    }
    if (armor[1].includes("ENCRYPTED")) {
        throw new Error("That key file is protected by a password. Remove the password first.");
    }
    let der: Uint8Array;
    try {
        der = Uint8Array.from(atob(armor[2].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    } catch {
        throw new Error("That key file could not be read.");
    }
    const hex = bytesToHex(der);
    const curve: Curve | undefined = hex.includes(OID_K1)
        ? "secp256k1"
        : hex.includes(OID_R1)
          ? "secp256r1"
          : undefined;
    if (!curve) throw new Error("Only secp256k1 and P-256 keys can be used here.");
    // ECPrivateKey ::= SEQUENCE { version 1, privateKey OCTET STRING (32), ... }
    const at = hex.indexOf("0201010420");
    if (at < 0) throw new Error("That key file could not be read.");
    const secret = hexToBytes(hex.slice(at + 10, at + 10 + 64));
    if (secret.length !== 32) throw new Error("That key file could not be read.");
    const point = bytesToHex(curves[curve].getPublicKey(secret, true));
    if (curve === "secp256r1" && armor[1] !== "PRIVATE KEY") {
        throw new Error("For a P-256 key, use the PKCS#8 form (BEGIN PRIVATE KEY).");
    }
    return {
        curve,
        secret,
        point,
        pem: curve === "secp256k1" ? privateKeyPem(secret) : armor[0] + "\n",
    };
};

/** Signs a 32-byte digest with a pasted key; hex r || s, low-S. */
export const signWith = (key: PastedKey, digest: Uint8Array): string =>
    curves[key.curve].sign(digest, key.secret, { lowS: true }).toCompactHex();

/** A public key as the chain writes it (PEM or hex DER), as hex DER. */
export const derHex = (key: string): string =>
    key.includes("BEGIN")
        ? bytesToHex(
              Uint8Array.from(
                  atob(key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")),
                  (c) => c.charCodeAt(0),
              ),
          )
        : key.toLowerCase();
