// Bitcoin's wallet import format as common-lib implements it, against
// libraries/psibase/common/tests/wif-vectors.json: the file that the C++
// definition (psibase/wif.hpp), Rust's psibase::wif and psinode.py are
// tested against too. Runs on Node's built-in TypeScript support.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import elliptic from "elliptic";
import { WifError, looksLikeWif, wifDecode, wifEncode } from "../src/wif.ts";

const vectors = JSON.parse(
    readFileSync(
        new URL(
            "../../../../../../../libraries/psibase/common/tests/wif-vectors.json",
            import.meta.url,
        ),
        "utf8",
    ),
);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const unhex = (text) => Uint8Array.from(Buffer.from(text, "hex"));
const k1 = new elliptic.ec("secp256k1");

test("valid vectors", () => {
    assert.ok(vectors.valid.length >= 12);
    for (const v of vectors.valid) {
        const secret = unhex(v.secret);
        assert.equal(wifEncode(secret, v.compressed, v.network), v.wif, v.name);
        assert.ok(looksLikeWif(v.wif), v.name);
        const key = wifDecode(v.wif);
        assert.equal(hex(key.secret), v.secret, v.name);
        assert.equal(key.compressed, v.compressed, v.name);
        assert.equal(key.network, v.network, v.name);

        const point = k1.keyFromPrivate(key.secret).getPublic();
        assert.equal(point.encode("hex", true), v.publicKeyCompressed, v.name);
        assert.equal(point.encode("hex", false), v.publicKeyUncompressed, v.name);
    }
});

test("defaults are compressed and mainnet", () => {
    assert.equal(
        wifEncode(unhex("0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d")),
        "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617",
    );
});

test("white space at the ends", () => {
    assert.ok(vectors.whitespace.length > 0);
    for (const v of vectors.whitespace) {
        assert.ok(looksLikeWif(v.text), v.name);
        const key = wifDecode(v.text);
        const expected = wifDecode(v.wif);
        assert.equal(hex(key.secret), hex(expected.secret), v.name);
        assert.equal(key.compressed, expected.compressed, v.name);
        assert.equal(key.network, expected.network, v.name);
    }
});

test("invalid vectors", () => {
    assert.ok(vectors.invalid.length >= 20);
    for (const v of vectors.invalid) {
        assert.throws(
            () => wifDecode(v.text),
            (e) => e instanceof WifError && e.reason === v.error && e.message.length > 0,
            v.name,
        );
        assert.equal(looksLikeWif(v.text), v.looksLikeWif, v.name);
    }
});

test("encode refuses keys outside the group", () => {
    const order = unhex("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    for (const secret of [new Uint8Array(32), order, new Uint8Array(31)]) {
        assert.throws(() => wifEncode(secret), (e) => e instanceof WifError && e.reason === "bad-secret");
    }
});
