import {
    test,
    expect,
    jspiAvailable,
    replyObject,
    type CallArgs,
    type RawReply,
    type SupervisorHandle,
} from "../../../../e2e/fixtures";

// Suspected Phase 0 bug: plugin-to-plugin calls INTO a JSPI-compiled plugin.
//
// collectJspiExportNames (loader.ts) makes every export of a plugin that
// imports `send-request` promising (host:http, host:auth, ...), so calling one
// returns a Promise. Cross-plugin imports are built by buildInterfaceProxy as
// sync JS functions (host.syncCall -> Supervisor.call -> plugin.call), so a
// sync Wasm caller would get that Promise back instead of a value. Paths:
//   - host:accounts admin login -> host:auth set-logged-in-user
//   - host:http (logged-in user) -> host:auth get-active-query-token
//   - any app plugin -> host:http (here: packages:plugin queries get-schema
//     -> host:http get-json)
// These assert the DESIRED behavior (normal values, Supervisor responsive,
// clean call stack afterwards). A failure here is a product finding.

const APP = "tokens"; // any real app that isn't the network name
const user = () => `e2esp${Date.now()}`;

const packedB64 = (s: string) => {
    const bytes = Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]).toString("base64");
};

async function chainIdOf(devnet: {
    get: (s: string, p: string) => Promise<{ body: string }>;
}): Promise<string> {
    return JSON.parse((await devnet.get("supervisor", "/common/chainid")).body);
}

// host:db keys (Host/plugin/db/src/bucket.rs): host plugins write as service "host".
const tokenKey = (chain: string, u: string) =>
    `${chain}:non-trx:host:query_tokens-${u}:${APP}`;
const loggedInKey = (chain: string) =>
    `${chain}:non-trx:host:logged_in_user:${APP}`;

const ls = (sup: SupervisorHandle) => ({
    get: (k: string) =>
        sup.frame.evaluate((key) => localStorage.getItem(key), k),
    set: (k: string, v: string) =>
        sup.frame.evaluate(([key, val]) => localStorage.setItem(key, val), [
            k,
            v,
        ] as const),
    remove: (...ks: string[]) =>
        sup.frame.evaluate(
            (keys) => keys.forEach((k) => localStorage.removeItem(k)),
            ks,
        ),
});

const getJson = (endpoint: string): CallArgs => ({
    service: "host",
    plugin: "http",
    intf: "api",
    method: "getJson",
    params: [endpoint],
});
const whoami: CallArgs = {
    service: "host",
    plugin: "e2e-probe",
    intf: "api",
    method: "whoami",
    params: [],
};

const expectNoError = (raw: RawReply, what: string) => {
    const r = replyObject(raw);
    expect(r.noReply, `${what}: Supervisor never replied`).toBeUndefined();
    expect(r.isError, `${what}: ${r.name}: ${r.message}`).toBeUndefined();
    expect(r.name, `${what}: ${r.name}: ${r.message}`).toBeUndefined();
};

const note = (type: string, raw: RawReply) =>
    test.info().annotations.push({
        type,
        description: (JSON.stringify(raw) ?? String(raw)).slice(0, 400),
    });

async function assertResponsive(sup: SupervisorHandle) {
    const t0 = Date.now();
    await sup.frame.evaluate(() => 1);
    expect(Date.now() - t0, "Supervisor frame blocked").toBeLessThan(500);
}

// Wait until the held request reaches the proxy, or the call already replied
// (e.g. it failed before ever fetching). Returns whether it was seen in flight.
async function inflightOrReply(
    inflight: Set<string>,
    key: string,
    pending: Promise<unknown>,
    timeout = 10_000,
): Promise<boolean> {
    let settled = false;
    void pending.then(
        () => (settled = true),
        () => (settled = true),
    );
    await expect
        .poll(() => inflight.has(key) || settled, { timeout })
        .toBe(true);
    return inflight.has(key);
}

test.beforeEach(async ({ supervisor }) => {
    test.skip(
        !(await jspiAvailable(supervisor.frame)),
        "needs WebAssembly JSPI (WebAssembly.Suspending)",
    );
});

test.describe("login path", () => {
    // host:accounts admin login only accepts caller "host".
    test.use({ harnessApp: "host" });

    test("host:accounts admin login -> host:auth set-logged-in-user (JSPI export via sync proxy)", async ({
        devnet,
        supervisor,
    }) => {
        const u = user();
        const token = `tok-login-${Date.now()}`;
        const chain = await chainIdOf(devnet);
        const st = ls(supervisor);
        const path = "/common/set-auth-cookie";
        // Seed the query token so set-logged-in-user doesn't need to sign
        // one via transact (that needs the user's key in the vault).
        await st.set(tokenKey(chain, u), packedB64(token));
        devnet.proxy.stubs.set(path, { ms: 800 });
        try {
            const hits0 = devnet.proxy.stubHits.length;
            const r = await supervisor.callRaw({
                service: "host",
                plugin: "accounts",
                intf: "admin",
                method: "login",
                params: [u, APP],
            });
            const count = () =>
                devnet.proxy.stubHits
                    .slice(hits0)
                    .filter((h) => h.path === path).length;
            // set-logged-in-user's send-request must have finished BEFORE
            // login replied (it is part of the call).
            const atReply = count();
            note("login-reply", r);
            // Give a mis-awaited host:auth export time to finish, if it does.
            await new Promise((res) => setTimeout(res, 1500));
            note(
                "login-state",
                `cookie requests at reply: ${atReply}, 1.5 s later: ${count()}, logged_in_user stored: ${(await st.get(loggedInKey(chain))) !== null}`,
            );
            expectNoError(r, "login");
            expect(
                atReply,
                "login replied before host:auth set-logged-in-user finished its send-request",
            ).toBe(1);
            const hits = devnet.proxy.stubHits
                .slice(hits0)
                .filter((h) => h.path === path);
            expect(JSON.parse(hits[0].body).accessToken).toBe(token);
            // host:accounts recorded the login (not rolled back by logout()).
            expect(await st.get(loggedInKey(chain))).toBe(
                Buffer.from(u).toString("base64"),
            );
        } finally {
            devnet.proxy.stubs.delete(path);
            await st.remove(tokenKey(chain, u), loggedInKey(chain));
        }
    });
});

test.describe("as app", () => {
    test.use({ harnessApp: APP });

    // Logged-in state as host:accounts / host:auth store it (seeded directly,
    // so this test doesn't depend on the login path above).
    async function seedLogin(
        devnet: Parameters<typeof chainIdOf>[0],
        sup: SupervisorHandle,
    ) {
        const u = user();
        const token = `tok-http-${Date.now()}`;
        const chain = await chainIdOf(devnet);
        const st = ls(sup);
        await st.set(loggedInKey(chain), Buffer.from(u).toString("base64"));
        await st.set(tokenKey(chain, u), packedB64(token));
        return {
            token,
            cleanup: () => st.remove(loggedInKey(chain), tokenKey(chain, u)),
        };
    }

    test("logged-in host:http get-json attaches the query token (http -> accounts -> auth)", async ({
        devnet,
        supervisor,
    }) => {
        const { token, cleanup } = await seedLogin(devnet, supervisor);
        const path = `/__e2e/authed-${Date.now()}`;
        devnet.proxy.stubs.set(path, { ms: 1000, body: '{"ok":"authed"}' });
        try {
            const hits0 = devnet.proxy.stubHits.length;
            const pending = supervisor.callRaw(getJson(path));
            if (await inflightOrReply(devnet.proxy.inflight, path, pending))
                await assertResponsive(supervisor);
            const r = await pending;
            note("authed-reply", r);
            expectNoError(r, "getJson");
            expect(JSON.parse(r as string).ok).toBe("authed");
            const hit = devnet.proxy.stubHits
                .slice(hits0)
                .find((h) => h.path === path);
            expect(hit?.headers.authorization).toBe(`Bearer ${token}`);
        } finally {
            devnet.proxy.stubs.delete(path);
            await cleanup();
        }
    });

    test("non-host plugin -> host:http with a held fetch (packages get-schema)", async ({
        devnet,
        supervisor,
    }) => {
        const path = "/schema";
        devnet.proxy.stubs.set(path, { ms: 1500, body: '{"e2e":"schema"}' });
        try {
            const pending = supervisor.callRaw(
                {
                    service: "packages",
                    plugin: "plugin",
                    intf: "queries",
                    method: "getSchema",
                    params: ["accounts"],
                },
                30_000,
            );
            if (
                await inflightOrReply(
                    devnet.proxy.inflight,
                    path,
                    pending,
                    20_000,
                )
            )
                await assertResponsive(supervisor);
            const r = await pending;
            note("schema-reply", r);
            expectNoError(r, "getSchema");
            // get-schema returns option<string>; `.ok()` turns any host:http
            // error into none, so a wrong value shows up as null/undefined.
            expect(r).toBe('{"e2e":"schema"}');
        } finally {
            devnet.proxy.stubs.delete(path);
        }
    });

    test("after both, a follow-up call sees a clean service stack and later calls work", async ({
        devnet,
        supervisor,
    }) => {
        const before = await supervisor.callRaw(whoami);
        note("whoami-before", before);
        expect(Array.isArray(before), JSON.stringify(before)).toBe(true);
        const stack = before as unknown as string[];
        expect(stack[0]).toBe(APP);
        expect(stack[stack.length - 1]).toBe(APP); // get-sender

        const { cleanup } = await seedLogin(devnet, supervisor);
        const authed = `/__e2e/authed-c-${Date.now()}`;
        devnet.proxy.stubs.set(authed, { ms: 800 });
        devnet.proxy.stubs.set("/schema", { ms: 800, body: "{}" });
        try {
            note("c-authed", await supervisor.callRaw(getJson(authed)));
            note(
                "c-schema",
                await supervisor.callRaw({
                    service: "packages",
                    plugin: "plugin",
                    intf: "queries",
                    method: "getSchema",
                    params: ["accounts"],
                }),
            );

            // Right away (a fetch from a mis-awaited export may still be in
            // flight) and again after anything dangling has settled.
            const now = await supervisor.callRaw(whoami);
            note("whoami-now", now);
            expect(now).toEqual(before);
            await new Promise((r) => setTimeout(r, 2000));
            const later = await supervisor.callRaw(whoami);
            note("whoami-later", later);
            expect(later).toEqual(before);
        } finally {
            devnet.proxy.stubs.delete(authed);
            devnet.proxy.stubs.delete("/schema");
            await cleanup();
        }

        const tag = `sp-after-${Date.now()}`;
        const ok = await supervisor.call(
            getJson(`/__e2e/sleep?ms=50&tag=${tag}`),
        );
        expect(JSON.parse(ok as string).tag).toBe(tag);
    });
});
