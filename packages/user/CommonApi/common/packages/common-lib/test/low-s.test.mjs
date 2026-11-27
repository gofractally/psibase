// Proofs produced by common-lib must be in the low-S form (s <= n/2): it is
// the only form verify-sig accepts. Runs on Node's built-in TypeScript support.
import assert from "node:assert/strict";
import { test } from "node:test";
import elliptic from "elliptic";
import hashJs from "hash.js";
import {
    KeyType,
    signDigest,
    signatureToBin,
} from "../src/key-conversions.ts";

const curves = [
    { name: "secp256k1", keyType: KeyType.k1, ec: new elliptic.ec("secp256k1") },
    { name: "P-256", keyType: KeyType.r1, ec: new elliptic.ec("p256") },
];
const DIGESTS = 400;

const digestOf = (i) => hashJs.sha256().update(`digest ${i}`).digest();
const toBig = (bytes) => BigInt("0x" + Buffer.from(bytes).toString("hex"));

for (const { name, keyType, ec } of curves) {
    const n = BigInt("0x" + ec.n.toString(16));
    const keyPair = ec.keyFromPrivate(hashJs.sha256().update(`key ${name}`).digest());
    const rs = (proof) => ({
        r: Buffer.from(proof.slice(0, 32)).toString("hex"),
        s: Buffer.from(proof.slice(32)).toString("hex"),
    });

    test(`${name}: signDigest gives low-S proofs that verify`, () => {
        for (let i = 0; i < DIGESTS; ++i) {
            const digest = digestOf(i);
            const proof = signDigest({ keyType, keyPair }, digest);
            assert.equal(proof.length, 64);
            assert.ok(toBig(proof.slice(32)) <= n / 2n, `high S at digest ${i}`);
            assert.ok(keyPair.verify(digest, rs(proof)), `digest ${i} does not verify`);
        }
    });

    test(`${name}: the default signer does produce high-S, so the check means something`, () => {
        let high = 0;
        for (let i = 0; i < DIGESTS; ++i)
            if (BigInt("0x" + keyPair.sign(digestOf(i)).s.toString(16)) > n / 2n) ++high;
        assert.ok(high > DIGESTS / 4, `only ${high} of ${DIGESTS} high-S`);
    });

    test(`${name}: signatureToBin converts a high-S signature`, () => {
        let converted = 0;
        for (let i = 0; i < DIGESTS; ++i) {
            const digest = digestOf(i);
            const signature = keyPair.sign(digest); // not canonical
            const wasHigh = BigInt("0x" + signature.s.toString(16)) > n / 2n;
            const proof = signatureToBin({ keyType, signature });
            assert.ok(toBig(proof.slice(32)) <= n / 2n);
            assert.ok(keyPair.verify(digest, rs(proof)));
            converted += wasHigh;
        }
        assert.ok(converted > 0);
    });
}

test("signatureToBin refuses an unknown key type", () => {
    const ec = new elliptic.ec("secp256k1");
    const signature = ec.genKeyPair().sign(digestOf(0));
    assert.throws(() => signatureToBin({ keyType: 7, signature }));
    assert.throws(() => signatureToBin({ signature }));
});
