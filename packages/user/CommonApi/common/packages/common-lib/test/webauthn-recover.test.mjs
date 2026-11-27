// Recovery of a passkey's P-256 public key from a WebAuthn assertion, against
// libraries/psibase/common/tests/webauthn-p256-vectors.json (written by
// Node's built-in crypto, see webauthn-p256-vectors.mjs beside it) and
// against signatures that Node's crypto makes here. Runs on Node's built-in
// TypeScript support.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    WebauthnSignatureError,
    pickP256PublicKey,
    recoverP256PublicKeys,
    verifyWebauthnP256,
    webauthnSignedMessage,
} from "../src/webauthn-recover.ts";

const vectors = JSON.parse(
    readFileSync(
        new URL(
            "../../../../../../../libraries/psibase/common/tests/webauthn-p256-vectors.json",
            import.meta.url,
        ),
        "utf8",
    ),
);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const unhex = (text) => Uint8Array.from(Buffer.from(text, "hex"));
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

// A compressed point is on the curve: y^2 = x^3 - 3x + b has a root, checked
// with integers only (p = 3 mod 4, so a root is rhs^((p+1)/4))
const modpow = (base, exp, mod) => {
    let out = 1n;
    for (base %= mod; exp > 0n; exp >>= 1n, base = (base * base) % mod)
        if (exp & 1n) out = (out * base) % mod;
    return out;
};
function assertOnCurve(key, name) {
    assert.equal(key.length, 33, name);
    assert.ok(key[0] === 2 || key[0] === 3, name);
    const x = BigInt("0x" + hex(key.subarray(1)));
    assert.ok(x < P, name);
    const rhs = (((x * x * x - 3n * x + B) % P) + P) % P;
    const y = modpow(rhs, (P + 1n) / 4n, P);
    assert.equal((y * y) % P, rhs, `${name}: not a point of the curve`);
}

// Node's own opinion of a signature, for a compressed key: a
// SubjectPublicKeyInfo may hold the compressed point
const SPKI_COMPRESSED = "3039301306072a8648ce3d020106082a8648ce3d030107032200";
const nodeVerifies = (compressedKey, authData, clientData, signatureDer) =>
    crypto.verify(
        "sha256",
        Buffer.concat([authData, sha256(clientData)]),
        {
            key: crypto.createPublicKey({
                key: Buffer.from(SPKI_COMPRESSED + hex(compressedKey), "hex"),
                format: "der",
                type: "spki",
            }),
            dsaEncoding: "der",
        },
        signatureDer,
    );

const fields = (v) => [
    unhex(v.authenticatorData),
    unhex(v.clientDataJSON),
    unhex(v.signatureDer),
];

test("the functions are exported from the index", () => {
    // index.ts is written for the bundler and cannot be loaded here
    const text = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    assert.ok(text.includes('export * from "./webauthn-recover";'));
});

test("the signed message is authenticatorData || SHA-256(clientDataJSON)", () => {
    for (const v of vectors.valid) {
        const [authData, clientData] = fields(v);
        assert.equal(
            hex(webauthnSignedMessage(authData, clientData)),
            v.authenticatorData + hex(sha256(clientData)),
            v.name,
        );
    }
});

test("valid vectors: the key is among the candidates and is picked from each encoding", () => {
    assert.ok(vectors.valid.length >= 12);
    for (const v of vectors.valid) {
        const [authData, clientData, signatureDer] = fields(v);
        const candidates = recoverP256PublicKeys(authData, clientData, signatureDer);
        const found = candidates.map(hex);
        assert.equal(candidates.length, 2, v.name);
        assert.equal(new Set(found).size, candidates.length, v.name);
        assert.ok(found.includes(v.publicKeyCompressed), v.name);
        for (const key of candidates) assertOnCurve(key, v.name);
        // The same answer every time
        assert.deepEqual(
            recoverP256PublicKeys(authData, clientData, signatureDer).map(hex),
            found,
            v.name,
        );
        for (const known of [
            v.publicKeyCompressed,
            v.publicKeyUncompressed,
            v.publicKeySpki,
        ]) {
            const picked = pickP256PublicKey(candidates, unhex(known));
            assert.ok(picked, `${v.name}: not picked from ${known}`);
            assert.equal(hex(picked), v.publicKeyCompressed, v.name);
            assert.ok(
                verifyWebauthnP256(unhex(known), authData, clientData, signatureDer),
                `${v.name}: does not verify with ${known}`,
            );
        }
    }
});

test("valid vectors: every candidate verifies, so verification cannot choose between them", () => {
    for (const v of vectors.valid) {
        const [authData, clientData, signatureDer] = fields(v);
        for (const key of recoverP256PublicKeys(authData, clientData, signatureDer)) {
            assert.ok(verifyWebauthnP256(key, authData, clientData, signatureDer), v.name);
            // Not a quirk of this library: OpenSSL agrees
            assert.ok(nodeVerifies(key, authData, clientData, signatureDer), v.name);
        }
    }
});

test("valid vectors: verification fails for another key, other data and a changed signature", () => {
    const keys = [...new Set(vectors.valid.map((v) => v.publicKeyCompressed))];
    assert.ok(keys.length >= 4);
    for (const v of vectors.valid) {
        const [authData, clientData, signatureDer] = fields(v);
        const candidates = recoverP256PublicKeys(authData, clientData, signatureDer).map(hex);
        for (const other of keys) {
            if (candidates.includes(other)) continue;
            assert.equal(
                verifyWebauthnP256(unhex(other), authData, clientData, signatureDer),
                false,
                v.name,
            );
            assert.equal(pickP256PublicKey(candidates.map(unhex), unhex(other)), undefined);
        }
        const key = unhex(v.publicKeyCompressed);
        const changedAuth = Uint8Array.from(authData);
        changedAuth[36] ^= 1; // the counter
        assert.equal(verifyWebauthnP256(key, changedAuth, clientData, signatureDer), false, v.name);
        const changedClient = Uint8Array.from(clientData);
        changedClient[40] ^= 1; // inside the challenge
        assert.equal(verifyWebauthnP256(key, authData, changedClient, signatureDer), false, v.name);
        const changedSignature = Uint8Array.from(signatureDer);
        changedSignature[signatureDer.length - 1] ^= 1; // the end of s
        assert.equal(verifyWebauthnP256(key, authData, clientData, changedSignature), false, v.name);
        // Changed data gives other candidates, none of them the key
        assert.equal(
            pickP256PublicKey(recoverP256PublicKeys(changedAuth, clientData, signatureDer), key),
            undefined,
            v.name,
        );
    }
});

test("valid vectors cover high-S, low-S, padded and short integers", () => {
    const parts = (v) => {
        const der = unhex(v.signatureDer);
        const r = der.subarray(4, 4 + der[3]);
        const s = der.subarray(4 + der[3] + 2);
        return { r, s, sValue: BigInt("0x" + hex(s)) };
    };
    const all = vectors.valid.map(parts);
    assert.ok(all.some((p) => p.sValue > N / 2n), "no high-S vector");
    assert.ok(all.some((p) => p.sValue <= N / 2n), "no low-S vector");
    assert.ok(all.some((p) => p.r.length === 33 && p.r[0] === 0), "no padded r");
    assert.ok(all.some((p) => p.s.length === 33 && p.s[0] === 0), "no padded s");
    assert.ok(all.some((p) => p.r.length < 32), "no short r");
    assert.ok(all.some((p) => p.s.length < 32), "no short s");
    assert.ok(vectors.valid.some((v) => unhex(v.authenticatorData).length > 37), "no extensions");
    assert.ok(vectors.valid.some((v) => unhex(v.authenticatorData).length === 37));
});

test("invalid vectors throw, each for its reason, and do not verify", () => {
    const reasons = new Set();
    const key = unhex(vectors.valid[0].publicKeyCompressed);
    for (const v of vectors.invalid) {
        const [authData, clientData, signatureDer] = fields(v);
        assert.throws(
            () => recoverP256PublicKeys(authData, clientData, signatureDer),
            (e) =>
                e instanceof WebauthnSignatureError &&
                e.reason === v.error &&
                e.message.startsWith("WebAuthn signature: "),
            v.name,
        );
        assert.equal(verifyWebauthnP256(key, authData, clientData, signatureDer), false, v.name);
        reasons.add(v.error);
    }
    for (const name of [
        "truncated",
        "trailing-byte",
        "r-zero",
        "s-zero",
        "r-equals-n",
        "wrong-sequence-tag",
    ]) {
        assert.ok(vectors.invalid.some((v) => v.name === name), `no ${name} vector`);
    }
    assert.deepEqual([...reasons].sort(), ["bad-der", "not-recoverable", "out-of-range"]);
});

test("a key that is not a P-256 public key is never picked and never verifies", () => {
    const v = vectors.valid[0];
    const [authData, clientData, signatureDer] = fields(v);
    const candidates = recoverP256PublicKeys(authData, clientData, signatureDer);
    const good = unhex(v.publicKeyCompressed);
    const k1 = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const offCurve = unhex(v.publicKeyUncompressed);
    offCurve[64] ^= 1;
    const notAField = Uint8Array.from([2, ...new Array(32).fill(0xff)]);
    for (const [name, key] of [
        ["empty", new Uint8Array(0)],
        ["32 bytes", good.subarray(1)],
        ["wrong prefix", Uint8Array.from([4, ...good.subarray(1)])],
        ["x not below the prime", notAField],
        ["y changed", offCurve],
        ["SPKI with a trailing byte", Uint8Array.from([...unhex(v.publicKeySpki), 0])],
        ["secp256k1 SPKI", new Uint8Array(k1.publicKey.export({ type: "spki", format: "der" }))],
    ]) {
        assert.equal(pickP256PublicKey(candidates, key), undefined, name);
        assert.equal(verifyWebauthnP256(key, authData, clientData, signatureDer), false, name);
    }
    assert.equal(pickP256PublicKey([], good), undefined);
    // A SubjectPublicKeyInfo may hold the compressed point too
    const spkiCompressed = unhex(SPKI_COMPRESSED + v.publicKeyCompressed);
    assert.equal(hex(pickP256PublicKey(candidates, spkiCompressed)), v.publicKeyCompressed);
});

test("random signatures: recover, pick, verify; two assertions share exactly the key", () => {
    const KEYS = 12;
    const PER_KEY = 30;
    let highS = 0;
    for (let k = 0; k < KEYS; ++k) {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
            namedCurve: "prime256v1",
        });
        const spki = new Uint8Array(publicKey.export({ type: "spki", format: "der" }));
        const uncompressed = spki.subarray(26);
        const compressed = Uint8Array.from([
            2 + (uncompressed[64] & 1),
            ...uncompressed.subarray(1, 33),
        ]);
        let previous;
        for (let i = 0; i < PER_KEY; ++i) {
            const extensions = crypto.randomBytes(i % 3 === 0 ? crypto.randomInt(1, 40) : 0);
            const authData = new Uint8Array(
                Buffer.concat([
                    sha256("psibase.io"),
                    Buffer.from([extensions.length ? 0x85 : 0x05, 0, 0, 0, i]),
                    extensions,
                ]),
            );
            const clientData = new Uint8Array(
                Buffer.from(
                    JSON.stringify({
                        type: "webauthn.get",
                        challenge: crypto.randomBytes(32).toString("base64url"),
                        origin: "https://accounts.psibase.io",
                        crossOrigin: false,
                    }),
                ),
            );
            const signatureDer = new Uint8Array(
                crypto.sign("sha256", webauthnSignedMessage(authData, clientData), {
                    key: privateKey,
                    dsaEncoding: "der",
                }),
            );
            const sAt = 4 + signatureDer[3] + 2;
            if (BigInt("0x" + hex(signatureDer.subarray(sAt))) > N / 2n) ++highS;

            const candidates = recoverP256PublicKeys(authData, clientData, signatureDer);
            const label = `key ${k} signature ${i}: ${hex(signatureDer)}`;
            assert.equal(candidates.length, 2, label);
            for (const known of [compressed, uncompressed, spki]) {
                const picked = pickP256PublicKey(candidates, known);
                assert.ok(picked, label);
                assert.equal(hex(picked), hex(compressed), label);
            }
            for (const key of candidates) {
                assertOnCurve(key, label);
                assert.ok(verifyWebauthnP256(key, authData, clientData, signatureDer), label);
            }
            assert.ok(verifyWebauthnP256(spki, authData, clientData, signatureDer), label);

            const found = candidates.map(hex);
            if (previous) {
                const shared = found.filter((key) => previous.includes(key));
                assert.deepEqual(shared, [hex(compressed)], label);
            }
            previous = found;
        }
    }
    // Node does not normalize s, so about half are high: they are covered
    assert.ok(highS > (KEYS * PER_KEY) / 4, `only ${highS} high-S signatures`);
});
