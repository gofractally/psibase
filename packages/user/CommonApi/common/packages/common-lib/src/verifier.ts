// Which services verify signatures made with which kind of key.
//
// Each verifier service handles one kind of key. A kind of key has a default
// verifier and may have others that an account can choose instead; a claim
// for a key names one of them. Everything that builds or checks a claim asks
// here instead of naming a service. This mirrors psibase/verifier.hpp (C++)
// and psibase::verifier (Rust); the three must agree.
//
// A claim for an account must name the verifier the account stored with its
// key (auth-sig's `account(name) { active { key verifier } }`); verifierFor is only
// the default.

export type VerifiedKeyType = "secp256k1" | "secp256r1";

// AlgorithmIdentifier { id-ecPublicKey, namedCurve }
const algorithms: { [K in VerifiedKeyType]: number[] } = {
    secp256k1: [
        0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
        0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a,
    ],
    secp256r1: [
        0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
        0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    ],
};

// The verifiers allowed for each key type, the default first.
const verifiers: { [K in VerifiedKeyType]: readonly string[] } = {
    secp256k1: ["verify-k1"],
    secp256r1: ["verify-r1", "verify-br1"],
};

const keyTypes = Object.keys(verifiers) as VerifiedKeyType[];

function isKeyOfType(spki: Uint8Array, type: VerifiedKeyType): boolean {
    const algorithm = algorithms[type];
    // outer SEQUENCE header, algorithm, BIT STRING header with zero unused bits
    const header = 2 + algorithm.length + 3;
    if (spki.length !== header + 65 && spki.length !== header + 33)
        return false;
    const pointSize = spki.length - header;
    if (spki[0] !== 0x30 || spki[1] !== spki.length - 2) return false;
    if (!algorithm.every((byte, i) => spki[2 + i] === byte)) return false;
    const bits = 2 + algorithm.length;
    return (
        spki[bits] === 0x03 &&
        spki[bits + 1] === pointSize + 1 &&
        spki[bits + 2] === 0x00
    );
}

/** The type of the key whose DER SubjectPublicKeyInfo is `spki`, if a
 * verifier exists for it and it is encoded as that verifier requires:
 * exactly the fixed encoding for the curve, holding an uncompressed or a
 * compressed point. */
export function verifiedKeyType(spki: Uint8Array): VerifiedKeyType | undefined {
    return keyTypes.find((type) => isKeyOfType(spki, type));
}

/** The verifiers allowed for keys of this type, the default first. */
export function allowedVerifiersForKeyType(
    type: VerifiedKeyType,
): readonly string[] {
    return verifiers[type];
}

/** The default verifier for keys of this type. */
export function verifierForKeyType(type: VerifiedKeyType): string {
    return verifiers[type][0];
}

/** The default verifier for the key whose DER SubjectPublicKeyInfo is
 * `spki`: the service a claim for this key names unless another allowed
 * verifier was chosen for it. Undefined if no verifier accepts the key. */
export function verifierFor(spki: Uint8Array): string | undefined {
    const type = verifiedKeyType(spki);
    return type && verifiers[type][0];
}

/** The verifiers allowed for the key whose DER SubjectPublicKeyInfo is
 * `spki`, the default first. Empty if no verifier accepts the key. */
export function allowedVerifiers(spki: Uint8Array): readonly string[] {
    const type = verifiedKeyType(spki);
    return type ? verifiers[type] : [];
}

/** Whether `service` is one of the verifiers allowed for this key. */
export function isAllowedVerifier(service: string, spki: Uint8Array): boolean {
    return allowedVerifiers(spki).includes(service);
}

/** `verifierFor`, for building a claim: throws if there is no verifier. */
export function requireVerifierFor(spki: Uint8Array): string {
    const result = verifierFor(spki);
    if (!result) throw new Error("unsupported public key");
    return result;
}
