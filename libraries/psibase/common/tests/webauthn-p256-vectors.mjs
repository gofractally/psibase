#!/usr/bin/env node
// Writes webauthn-p256-vectors.json: WebAuthn ES256 assertions and the
// public keys that made them, for testing the recovery of a passkey's
// public key from an assertion (common-lib's webauthn-recover.ts).
//
// This is deliberately not that implementation: keys and signatures come
// from Node's built-in crypto (OpenSSL), and the malformed signatures are
// put together here byte by byte.
//
//    node webauthn-p256-vectors.mjs            # rewrites the file beside it
//    node webauthn-p256-vectors.mjs --check    # checks the file beside it
//
// The keys are fixed, but ECDSA signatures are random, so a rewrite gives
// different signatures with the same properties. --check does not compare:
// it verifies every assertion in the file with Node's crypto and checks that
// the properties the names promise hold.
//
// No authenticator was involved. The authenticatorData and clientDataJSON
// have the layout that the WebAuthn specification gives and browsers emit.
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("webauthn-p256-vectors.json", import.meta.url);

// P-256
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const big = (bytes) => BigInt("0x" + (hex(bytes) || "0"));
const bytes32 = (n) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");

const modpow = (base, exp, mod) => {
    let out = 1n;
    for (base %= mod; exp > 0n; exp >>= 1n, base = (base * base) % mod)
        if (exp & 1n) out = (out * base) % mod;
    return out;
};
// Whether some point of the curve has this x: x^3 - 3x + b is a square
const isX = (x) => {
    const rhs = (((x * x * x - 3n * x + B) % P) + P) % P;
    return rhs === 0n || modpow(rhs, (P - 1n) / 2n, P) === 1n;
};

// ---- keys -----------------------------------------------------------------

function makeKey(index) {
    const d = sha256(`webauthn-p256-vectors key ${index}`);
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(d);
    const uncompressed = ecdh.getPublicKey();
    const compressed = ecdh.getPublicKey(null, "compressed");
    const privateKey = crypto.createPrivateKey({
        format: "jwk",
        key: {
            kty: "EC",
            crv: "P-256",
            d: d.toString("base64url"),
            x: uncompressed.subarray(1, 33).toString("base64url"),
            y: uncompressed.subarray(33).toString("base64url"),
        },
    });
    const spki = crypto
        .createPublicKey(privateKey)
        .export({ type: "spki", format: "der" });
    return { privateKey, compressed, uncompressed, spki };
}

// ---- assertions -----------------------------------------------------------

// Flags of authenticatorData
const UP = 0x01; // user present
const UV = 0x04; // user verified
const BE = 0x08; // backup eligible
const BS = 0x10; // backed up
const ED = 0x80; // extension data follows

// CBOR { "credBlob": h'...' }: an extension output as an authenticator
// appends it
const credBlob = (blob) =>
    Buffer.concat([
        Buffer.from([0xa1, 0x68]),
        Buffer.from("credBlob"),
        Buffer.from([0x40 + blob.length]),
        blob,
    ]);

function authenticatorData({ rpId, flags, counter, extensions }) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
        sha256(rpId),
        Buffer.from([flags | (extensions ? ED : 0)]),
        count,
        extensions ?? Buffer.alloc(0),
    ]);
}

function clientDataJSON({ origin, extra }) {
    const challenge = crypto.randomBytes(32).toString("base64url");
    // The order and spelling browsers use (WebAuthn, "serialization of
    // client data")
    let json =
        `{"type":"webauthn.get","challenge":"${challenge}",` +
        `"origin":${JSON.stringify(origin)},` +
        `"crossOrigin":${extra?.crossOrigin ?? false}`;
    if (extra?.topOrigin) json += `,"topOrigin":${JSON.stringify(extra.topOrigin)}`;
    if (extra?.tail) json += `,${extra.tail}`;
    return Buffer.from(json + "}");
}

// DER SEQUENCE { INTEGER r, INTEGER s }, as lenient as needed to take apart
// what OpenSSL wrote
function splitDer(der) {
    const rLength = der[3];
    const r = der.subarray(4, 4 + rLength);
    const s = der.subarray(4 + rLength + 2);
    return { r, s };
}

const minimal = (n) => {
    let bytes = bytes32(n);
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    return bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
};
const integer = (content) =>
    Buffer.concat([Buffer.from([0x02, content.length]), content]);
const sequence = (...parts) => {
    const content = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([0x30, content.length]), content]);
};

// What a vector's name promises, computed from its bytes
function properties(authData, clientData, signatureDer) {
    const { r, s } = splitDer(signatureDer);
    return {
        highS: big(s) > N / 2n,
        rBytes: r.length,
        sBytes: s.length,
        digest0: sha256(Buffer.concat([authData, sha256(clientData)]))[0],
    };
}

const wants = {
    any: () => true,
    highS: (p) => p.highS,
    lowS: (p) => !p.highS,
    rPadded: (p) => p.rBytes === 33 && p.sBytes === 32,
    sPadded: (p) => p.sBytes === 33 && p.rBytes === 32,
    bothPadded: (p) => p.rBytes === 33 && p.sBytes === 33,
    neitherPadded: (p) => p.rBytes === 32 && p.sBytes === 32,
    rShort: (p) => p.rBytes < 32,
    sShort: (p) => p.sBytes < 32,
    digestLeadingZero: (p) => p.digest0 === 0,
};

const ORIGIN = "https://accounts.psibase.io";
const plain = { rpId: "psibase.io", flags: UP | UV, counter: 0, origin: ORIGIN };

// name, key, what the signature must be like, the assertion
const cases = [
    ["plain", 0, "any", plain],
    ["second-key-user-present-only", 1, "any", { ...plain, flags: UP, counter: 1 }],
    ["third-key-synced-passkey", 2, "any", { ...plain, flags: UP | UV | BE | BS }],
    ["fourth-key-localhost-origin", 3, "any", { ...plain, rpId: "localhost", origin: "https://psibase.localhost:8090", counter: 41 }],
    ["fifth-key-large-counter", 4, "any", { ...plain, counter: 0xfffffffe }],
    ["high-s", 0, "highS", plain],
    ["low-s", 0, "lowS", plain],
    ["r-padded", 1, "rPadded", plain],
    ["s-padded", 1, "sPadded", plain],
    ["both-padded", 2, "bothPadded", plain],
    ["neither-padded", 2, "neitherPadded", plain],
    ["r-short", 3, "rShort", plain],
    ["s-short", 3, "sShort", plain],
    ["digest-leading-zero", 4, "digestLeadingZero", plain],
    ["extensions", 4, "any", { ...plain, extensions: credBlob(Buffer.from("psibase!")) }],
    ["extensions-high-s", 0, "highS", { ...plain, flags: UP | UV | BE, counter: 7, extensions: credBlob(sha256("blob")) }],
    ["cross-origin", 1, "any", { ...plain, extra: { crossOrigin: true, topOrigin: "https://homepage.psibase.io" } }],
    ["client-data-with-extra-member", 2, "highS", { ...plain, extra: { tail: '"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"' } }],
];

function assertion(key, want, options) {
    for (;;) {
        const authData = authenticatorData(options);
        const clientData = clientDataJSON(options);
        const message = Buffer.concat([authData, sha256(clientData)]);
        const signatureDer = crypto.sign("sha256", message, {
            key: key.privateKey,
            dsaEncoding: "der",
        });
        if (wants[want](properties(authData, clientData, signatureDer)))
            return { authData, clientData, signatureDer };
    }
}

function generate() {
    const keys = [0, 1, 2, 3, 4].map(makeKey);
    const valid = cases.map(([name, keyIndex, want, options]) => {
        const key = keys[keyIndex];
        const a = assertion(key, want, options);
        return {
            name,
            is: want,
            authenticatorData: hex(a.authData),
            clientDataJSON: hex(a.clientData),
            signatureDer: hex(a.signatureDer),
            publicKeyCompressed: hex(key.compressed),
            publicKeyUncompressed: hex(key.uncompressed),
            publicKeySpki: hex(key.spki),
        };
    });

    // The malformed signatures all start from one good one
    const base = assertion(keys[0], "neitherPadded", plain);
    const good = splitDer(base.signatureDer);
    const [r, s] = [big(good.r), big(good.s)];
    const topClear = r & ((1n << 255n) - 1n);
    const topSet = topClear | (1n << 255n); // below n: n starts with ffffffff
    let offCurve = r;
    while (isX(offCurve)) ++offCurve;
    const R = integer(minimal(r));
    const S = integer(minimal(s));
    const der = base.signatureDer;
    const invalid = [
        ["empty", Buffer.alloc(0), "bad-der"],
        ["truncated", der.subarray(0, der.length - 1), "bad-der"],
        ["truncated-inside-r", der.subarray(0, 10), "bad-der"],
        ["truncated-before-s", sequence(R), "bad-der"],
        ["trailing-byte", Buffer.concat([der, Buffer.from([0])]), "bad-der"],
        ["trailing-byte-inside-sequence", sequence(R, S, Buffer.from([0])), "bad-der"],
        ["wrong-sequence-tag", Buffer.concat([Buffer.from([0x31]), der.subarray(1)]), "bad-der"],
        ["wrong-integer-tag", sequence(Buffer.concat([Buffer.from([0x03]), R.subarray(1)]), S), "bad-der"],
        ["long-form-length", Buffer.concat([Buffer.from([0x30, 0x81]), der.subarray(1)]), "bad-der"],
        ["sequence-length-too-small", Buffer.concat([Buffer.from([0x30, der[1] - 1]), der.subarray(2)]), "bad-der"],
        ["r-needless-zero", sequence(integer(Buffer.concat([Buffer.from([0]), bytes32(topClear)])), S), "bad-der"],
        ["r-negative", sequence(integer(bytes32(topSet)), S), "bad-der"],
        ["s-negative", sequence(R, integer(bytes32(topSet))), "bad-der"],
        ["r-empty", sequence(integer(Buffer.alloc(0)), S), "bad-der"],
        ["r-too-long", sequence(integer(Buffer.concat([Buffer.from([0, 0x80]), bytes32(r)])), S), "bad-der"],
        ["r-zero", sequence(integer(Buffer.from([0])), S), "out-of-range"],
        ["s-zero", sequence(R, integer(Buffer.from([0]))), "out-of-range"],
        ["r-equals-n", sequence(integer(minimal(N)), S), "out-of-range"],
        ["r-above-n", sequence(integer(minimal(N + 1n)), S), "out-of-range"],
        ["r-all-ones", sequence(integer(minimal((1n << 256n) - 1n)), S), "out-of-range"],
        ["s-equals-n", sequence(R, integer(minimal(N))), "out-of-range"],
        ["r-not-on-curve", sequence(integer(minimal(offCurve)), S), "not-recoverable"],
    ].map(([name, signatureDer, error]) => ({
        name,
        authenticatorData: hex(base.authData),
        clientDataJSON: hex(base.clientData),
        signatureDer: hex(signatureDer),
        error,
    }));

    return {
        description:
            "WebAuthn ES256 assertions (ECDSA P-256 / SHA-256 over " +
            "authenticatorData || SHA-256(clientDataJSON), DER signature) " +
            "with the public key that made each, and malformed signatures. " +
            "Written by webauthn-p256-vectors.mjs with Node's built-in " +
            "crypto; no authenticator was involved. All values are hex. " +
            "'is' names the property the signature was chosen for.",
        valid,
        invalid,
    };
}

// ---- check ----------------------------------------------------------------

function check(vectors) {
    const fail = (name, what) => {
        throw new Error(`${name}: ${what}`);
    };
    if (vectors.valid.length < 12) fail("valid", "fewer than 12 vectors");
    const prefixes = new Set();
    for (const v of vectors.valid) {
        const [authData, clientData, signatureDer, spki] = [
            v.authenticatorData,
            v.clientDataJSON,
            v.signatureDer,
            v.publicKeySpki,
        ].map((h) => Buffer.from(h, "hex"));
        const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
        const message = Buffer.concat([authData, sha256(clientData)]);
        if (!crypto.verify("sha256", message, { key, dsaEncoding: "der" }, signatureDer))
            fail(v.name, "does not verify");
        if (!wants[v.is](properties(authData, clientData, signatureDer)))
            fail(v.name, `is not ${v.is}`);
        const jwk = key.export({ format: "jwk" });
        const xy = hex(Buffer.from(jwk.x, "base64url")) + hex(Buffer.from(jwk.y, "base64url"));
        if (v.publicKeyUncompressed !== "04" + xy) fail(v.name, "uncompressed key differs");
        const odd = Number.parseInt(xy.slice(-1), 16) & 1;
        if (v.publicKeyCompressed !== (odd ? "03" : "02") + xy.slice(0, 64))
            fail(v.name, "compressed key differs");
        prefixes.add(v.publicKeyCompressed.slice(0, 2));
        if (authData.length < 37) fail(v.name, "authenticatorData is short");
        const client = JSON.parse(clientData.toString());
        if (client.type !== "webauthn.get") fail(v.name, "clientDataJSON type");
    }
    if (prefixes.size !== 2) fail("valid", "keys with even and with odd y are both needed");
    for (const name of Object.keys(wants))
        if (name !== "any" && !vectors.valid.some((v) => v.is === name))
            fail("valid", `no vector is ${name}`);
    for (const v of vectors.invalid)
        if (!["bad-der", "out-of-range", "not-recoverable"].includes(v.error))
            fail(v.name, "unknown error name");
}

if (process.argv.includes("--check")) {
    const vectors = JSON.parse(readFileSync(FILE, "utf8"));
    check(vectors);
    console.log(
        `webauthn-p256-vectors.json: ${vectors.valid.length} valid, ` +
            `${vectors.invalid.length} invalid, all as described`,
    );
} else {
    const vectors = generate();
    check(vectors);
    writeFileSync(FILE, JSON.stringify(vectors, null, 2) + "\n");
    console.log(
        `wrote ${vectors.valid.length} valid and ${vectors.invalid.length} invalid vectors`,
    );
}
