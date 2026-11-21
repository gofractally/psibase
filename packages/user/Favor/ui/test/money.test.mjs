import { test } from "node:test";
import assert from "node:assert/strict";
import {
    units,
    readUnits,
    decimal,
    display,
    ppm,
    percent,
    readPaymentLink,
    paymentLink,
} from "../src/money.mjs";
test("amounts remain exact through eight decimals", () => {
    for (const s of ["0", "1", "0.00000001", "42.50000001", "90000000"])
        assert.equal(units(decimal(units(s))), units(s));
    assert.equal(decimal(units("0.1") + units("0.2")), "0.3");
});
test("invalid and out of range amounts are rejected", () => {
    for (const s of ["-1", "NaN", "1e3", ".1", "1.", " 1", "1.000000001", "90000000.00000001"])
        assert.throws(() => units(s));
});
test("routing percentages convert exactly to ppm", () => {
    assert.equal(ppm("0.0001"), 1);
    assert.equal(ppm("0.25"), 2500);
    assert.equal(ppm("100"), 1000000);
    assert.equal(percent(2500), "0.25");
    assert.throws(() => ppm("100.0001"));
    assert.throws(() => ppm("0.00001"));
});
test("display never rounds a financial amount", () => {
    assert.equal(display("12345678.00000001"), "12,345,678.00000001");
    assert.equal(display("5"), "5.00");
});
test("request secret stays in URL fragment", () => {
    const link = paymentLink("http://favor.psibase.localhost:8089", {
        to: "alice",
        symbol: "USD",
        amount: "5",
        request: "private-secret",
    });
    const url = new URL(link);
    assert.equal(url.pathname, "/");
    assert.equal(url.search, "");
    assert(!url.origin.includes("private-secret"));
    assert.deepEqual(readPaymentLink(url.hash), {
        to: "alice",
        symbol: "USD",
        amount: "5",
        request: "private-secret",
        note: "",
    });
});
test("demo links preserve the explicit demo mode", () => {
    const link = paymentLink("http://favor.psibase.localhost:8089?demo=1", { to: "dan" });
    assert.equal(new URL(link).search, "?demo=1");
});

test("derived capacity can exceed the per-payment input limit", () => {
    assert.equal(readUnits("180000000"), 18000000000000000n);
    assert.throws(() => units("180000000"));
});
