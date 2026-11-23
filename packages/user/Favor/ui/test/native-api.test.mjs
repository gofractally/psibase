import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

// Run the production adapter, replacing only the chain-hosted Common API import.
// These fixtures validate transport and pagination, not installed WASM plugins.
const source = stripTypeScriptTypes(
    readFileSync(new URL("../src/api.ts", import.meta.url), "utf8"),
);
const nativeImport = 'return (await import("@psibase/common-lib")).getSupervisor();';
assert.ok(source.includes(nativeImport));
const executable = `(function () {${source
    .replace(nativeImport, "return nativeClient.getSupervisor();")
    .replace("export const liveApi", "const liveApi")}\nreturn liveApi;})()`;

function fixture(handler) {
    const calls = [];
    const nativeClient = {
        getSupervisor() {
            return {
                async functionCall(args) {
                    calls.push(JSON.parse(JSON.stringify(args)));
                    return handler(args);
                },
            };
        },
    };
    return { api: vm.runInNewContext(executable, { nativeClient }), calls };
}
const page = (nodes = [], endCursor = null, hasNextPage = false) => ({
    nodes,
    endCursor,
    hasNextPage,
});

test("native account discovery uses Host after the removed Accounts method is rejected", async () => {
    const f = fixture(({ service, method }) => {
        if (service === "accounts") throw new Error("Unrecognized call: api:get-current-user");
        if (method === "getCurrentUser") return "alice";
    });
    assert.equal(await f.api.user(), "alice");
    await f.api.connect();
    await f.api.logout();
    assert.deepEqual(f.calls, [
        { service: "accounts", intf: "api", method: "getCurrentUser", params: [], plugin: "query" },
        { service: "host", intf: "api", method: "getCurrentUser", params: [], plugin: "accounts" },
        {
            service: "host",
            intf: "activeApp",
            method: "connectAccount",
            params: [],
            plugin: "accounts",
        },
        { service: "host", intf: "activeApp", method: "logout", params: [], plugin: "accounts" },
    ]);
});

test("legacy account discovery keeps connect and logout on the matching native plugin", async () => {
    const f = fixture(({ method }) => (method === "getCurrentUser" ? null : undefined));
    assert.equal(await f.api.user(), null);
    await f.api.connect();
    await f.api.logout();
    assert.deepEqual(f.calls.slice(1), [
        {
            service: "accounts",
            intf: "activeApp",
            method: "connectAccount",
            params: [],
            plugin: "plugin",
        },
        { service: "accounts", intf: "activeApp", method: "logout", params: [], plugin: "plugin" },
    ]);
});

test("account authorization and transport errors cannot be mistaken for an API migration", async () => {
    for (const message of ["Permission denied", "Plugin download failed.", "Network unavailable"]) {
        const f = fixture(() => {
            throw new Error(message);
        });
        await assert.rejects(() => f.api.user(), new RegExp(message.replaceAll(".", "\\.")));
        assert.equal(f.calls.length, 1);
    }
});

test("snapshot drains every private page and quotes native cursors as data", async () => {
    const cursor = 'USD:alice" } injected { "';
    let linePage = 0;
    const f = fixture(({ service, intf, method, params }) => {
        assert.equal(service, "favor");
        assert.equal(intf, "authorized");
        assert.equal(method, "graphql");
        const [query] = params;
        if (query.includes("lines(")) {
            linePage += 1;
            if (linePage === 1)
                return JSON.stringify({ data: { lines: page([{ peer: "bob" }], cursor, true) } });
            assert.ok(query.includes(`after:${JSON.stringify(cursor)}`));
            return { data: { lines: page([{ peer: "carol" }], "last") } };
        }
        if (query.includes("requests(")) return { data: { requests: page([{ hash: "hash" }]) } };
        return { data: { activity: page([{ id: "12" }]), settings: { routingReady: true } } };
    });
    const snapshot = await f.api.snapshot();
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
        lines: [{ peer: "bob" }, { peer: "carol" }],
        requests: [{ hash: "hash" }],
        activity: page([{ id: "12" }]),
        settings: { routingReady: true },
    });
    assert.equal(f.calls.length, 4);
});

test("snapshot stops on missing or repeated cursors instead of looping", async () => {
    for (const cursor of [null, "repeated"]) {
        let linePages = 0;
        const f = fixture(({ params: [query] }) => {
            if (query.includes("lines(")) {
                linePages += 1;
                return { data: { lines: page([], cursor, true) } };
            }
            if (query.includes("requests(")) return { data: { requests: page() } };
            return { data: { activity: page(), settings: {} } };
        });
        await assert.rejects(() => f.api.snapshot(), /Unable to load the next page/);
        assert.equal(linePages, cursor ? 2 : 1);
    }
});

test("quote and payment preserve exact reviewed amounts, route and reference", async () => {
    const quote = {
        payee: "carol",
        symbol: "BTC",
        amount: "0.00000001",
        total: "0.00000002",
        fee: "0.00000001",
        encodedRoute: "encrypted-route",
        reference: 'ref"\\',
        expiresAt: "999",
    };
    const request = 'secret"\\\n';
    const f = fixture(({ method, params: [query] }) => {
        if (method === "graphql") {
            assert.ok(query.includes(`reference:${JSON.stringify(quote.reference)}`));
            assert.ok(query.includes(`requestSecret:${JSON.stringify(request)}`));
            return JSON.stringify({ data: { quote } });
        }
    });
    const reviewed = await f.api.quote(
        quote.payee,
        quote.symbol,
        quote.amount,
        quote.reference,
        request,
    );
    await f.api.pay(reviewed, "memo");
    assert.deepEqual(f.calls[1], {
        service: "favor",
        intf: "api",
        method: "pay",
        params: [
            quote.payee,
            quote.symbol,
            quote.amount,
            quote.total,
            quote.encodedRoute,
            quote.reference,
            "memo",
        ],
    });
});

test("native query errors never become successful empty account data", async () => {
    for (const response of [{ errors: [{ message: "Authentication required" }] }, {}]) {
        const f = fixture(() => response);
        await assert.rejects(
            () => f.api.snapshot(),
            /Authentication required|network did not return a response/,
        );
    }
});
