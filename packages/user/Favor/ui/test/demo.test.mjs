import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { demoApi } from "../src/demo.ts";
let storage = new Map();
globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, v),
};
beforeEach(() => {
    storage = new Map();
});
test("demo route is self-contained and survives a new adapter", async () => {
    const one = demoApi();
    await one.snapshot();
    const q = await one.quote("jon", "USD", "20", "reference-0001", "");
    assert.equal(q.total, "20.03");
    const two = demoApi();
    await two.pay(q, "Coffee");
    const s = await two.snapshot();
    assert.equal(s.activity.nodes[0].outgoing, "jon");
    assert.equal(s.lines.find((l) => l.peer === "mike" && l.symbol === "USD").theyOwe, "14.97");
    await assert.rejects(() => two.pay(q, "Replay"));
});
test("credit changes invalidate outstanding demo routes", async () => {
    const api = demoApi();
    const q = await api.quote("jon", "USD", "20", "reference-0002", "");
    await api.setLine("mike", "USD", "150", 2500, true);
    await assert.rejects(() => api.pay(q, ""), /Credit changed/);
});
test("repayment does not create a new debt", async () => {
    const api = demoApi();
    await api.settle("mike", "USD", "5", "repayment-0001");
    const s = await api.snapshot();
    assert.equal(s.lines.find((l) => l.peer === "mike" && l.symbol === "USD").theyOwe, "30");
    await assert.rejects(() => api.settle("mike", "USD", "31", "repayment-0002"));
});
