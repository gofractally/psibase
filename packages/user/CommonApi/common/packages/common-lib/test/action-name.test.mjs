import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import {
    buildActionName,
    outputDirectory,
    packageDirectory,
} from "./build-action-name.mjs";

await buildActionName();
const codec = await import(
    pathToFileURL(resolve(outputDirectory, "action-name.mjs"))
);
const repo = resolve(packageDirectory, "../../../../../..");
const vectors = JSON.parse(
    await readFile(
        resolve(
            repo,
            "libraries/psibase/common/share/action-name-vectors.json",
        ),
        "utf8",
    ),
);
const hashVector = vectors.vectors.find(
    (row) => !row.text.startsWith("#") && BigInt(row.value_u64) >> 62n === 3n,
);
assert.ok(hashVector, "shared corpus must exercise actual hash fallback");

test("matches every shared golden ID and exact round trip", () => {
    assert.equal(codec.ACTION_NAME_MODEL_SHA256, vectors.model_sha256);
    assert.equal(codec.ACTION_NAME_FORMAT_VERSION, vectors.format_version);
    const modes = new Set();
    for (const row of vectors.vectors) {
        const value = codec.encodeActionName(row.text);
        assert.equal(String(value), row.value_u64, row.text);
        assert.equal(codec.decodeActionName(value), row.decoded, row.text);
        assert.equal(codec.encodeActionName(row.decoded), value, row.text);
        modes.add(Number(value >> 62n));
    }
    assert.deepEqual([...modes].sort(), [0, 1, 2, 3]);
});

test("normalization preserves digits and underscores while folding ASCII case", () => {
    assert.equal(
        codec.encodeActionName("RegisterEventIndex"),
        codec.encodeActionName("registereventindex"),
    );
    for (const [left, right] of [
        ["foo_bar", "fooqbar"],
        ["load0", "loado"],
        ["load1", "loadl"],
        ["getInt8", "getUint8"],
        ["sx", "szziat"],
    ]) {
        assert.notEqual(
            codec.encodeActionName(left),
            codec.encodeActionName(right),
        );
        assert.equal(
            codec.decodeActionName(codec.encodeActionName(left)),
            left.toLowerCase(),
        );
    }
});

test("hash fallback has the specified domain, endian and strict literal format", () => {
    const name = hashVector.text.toLowerCase();
    const digest = createHash("sha256")
        .update(`psibase.action_name.v1\0${name}`, "ascii")
        .digest();
    const value = (3n << 62n) | (digest.readBigUInt64LE() & ((1n << 62n) - 1n));
    assert.equal(codec.encodeActionName(name), value);
    const literal = `#${value.toString(16).padStart(16, "0")}`;
    assert.equal(codec.decodeActionName(value), literal);
    assert.equal(codec.encodeActionName(literal), value);
    for (const text of [
        "#ffffffffffffffff\n",
        "#FFFFFFFFFFFFFFFF",
        "#0000000000000000",
        "#short",
        "#fffffffffffffffg",
    ]) {
        assert.throws(() => codec.encodeActionName(text));
    }
});

test("rejects malformed names, noncanonical IDs and unbounded inputs", () => {
    for (const text of [
        ...vectors.invalid_names,
        "name\n",
        "name\r",
        "name\0",
        "1name",
        "é",
        "İ",
        "x".repeat(257),
    ]) {
        assert.throws(() => codec.encodeActionName(text), String(text));
    }
    for (const value of [0n, -1n, 1n << 64n, Number.MAX_SAFE_INTEGER, 1, "1"]) {
        assert.throws(() => codec.decodeActionName(value));
    }
    for (const raw of vectors.invalid_u64_decimal) {
        assert.throws(() => codec.decodeActionName(BigInt(raw)), raw);
    }
});

test("raw and JSON numeric transport never round through Number", () => {
    const value = codec.encodeActionName(hashVector.text);
    assert.ok(value > BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(codec.actionNameFromRaw(value), value);
    assert.equal(
        codec.actionNameFromJSON(codec.actionNameToJSON(value)),
        value,
    );
    assert.equal(
        JSON.parse(JSON.stringify({ method: codec.actionNameToJSON(value) }))
            .method,
        value.toString(),
    );
    for (const bad of [
        "01",
        "-1",
        "+1",
        "1.0",
        "1e2",
        " 1",
        "1\n",
        "",
        "18446744073709551616",
        1,
    ]) {
        assert.throws(() => codec.actionNameFromJSON(bad));
    }
    assert.throws(() => codec.actionNameFromRaw(1));
});

test("deterministic random names and arbitrary IDs have canonical round trips", () => {
    let state = 0x129a37;
    const random = () =>
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789_";
    for (let i = 0; i < 500; ++i) {
        let text = "a";
        for (let j = 0, length = random() % 64; j < length; ++j)
            text += alphabet[random() % alphabet.length];
        const value = codec.encodeActionName(text);
        const decoded = codec.decodeActionName(value);
        assert.equal(codec.encodeActionName(decoded), value);
        if (value >> 62n !== 3n) assert.equal(decoded, text);
        const raw = (BigInt(random()) << 32n) | BigInt(random());
        try {
            const canonical = codec.decodeActionName(raw);
            assert.equal(codec.encodeActionName(canonical), raw);
        } catch (error) {
            assert.ok(error instanceof TypeError);
        }
    }
});

test("browser-target bundle runs without Node, Buffer, crypto or DOM globals", async () => {
    const source = await readFile(
        resolve(outputDirectory, "action-name.browser.js"),
        "utf8",
    );
    const context = vm.createContext({});
    vm.runInContext(source, context, { timeout: 5000 });
    const browserCodec = context.ActionNameCodec;
    assert.equal(browserCodec.ACTION_NAME_MODEL_SHA256, vectors.model_sha256);
    for (const row of vectors.vectors.filter((_, index) => index % 47 === 0)) {
        assert.equal(
            String(browserCodec.encodeActionName(row.text)),
            row.value_u64,
        );
        assert.equal(
            browserCodec.decodeActionName(BigInt(row.value_u64)),
            row.decoded,
        );
    }
    const hashName = hashVector.text;
    assert.equal(
        browserCodec.encodeActionName(hashName),
        codec.encodeActionName(hashName),
    );
});
