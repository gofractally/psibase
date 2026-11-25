import {
    test,
    expect,
    jspiAvailable,
    replyObject,
    type CallArgs,
    type SupervisorHandle,
} from "../../../../e2e/fixtures";

// Phase 0 open question (wasm-async-fetches.md, "Cloud agent clarification",
// section 2, `addResourceProxy` row, marked unverified): how do resources
// built by loader.ts `addResourceProxy` (sync JS constructor/methods calling
// `syncCallResource`) behave in a JSPI-compiled plugin, around a JSPI
// suspension?
//
// Probe used (existing plugins only): host:auth is JSPI-compiled (it imports
// `send-request`) and uses host:db's `bucket` resource through
// addResourceProxy:
//   - get-active-query-token: Bucket::new + get, no suspension
//   - set-logged-in-user:     Bucket::new + get, then send-request
//                             (suspends), then Bucket::new + set
//   - log-out-user:           send-request (suspends), then Bucket::new + delete
// The bucket's key prefix includes the calling SERVICE from the Supervisor
// call stack (`get-sender`; host:auth's service is "host"), so writing the
// right localStorage key after resumption also shows the call stack was
// intact at that point.
//
// These assert the DESIRED behavior. The cases no real plugin reaches (a
// resource held ACROSS a suspension, and a resource whose own constructor or
// method suspends) use the TEST-ONLY probe plugins host:e2e-probe and
// host:e2e-probe-user (packages/user/Host/plugin/e2e-probe), which must be in
// the test chain's Host package.

// host:auth only accepts caller "host" (or "supervisor").
test.use({ harnessApp: "host" });

const APP = "network";

const auth = (method: string, params: unknown[]): CallArgs => ({
    service: "host",
    plugin: "auth",
    intf: "api",
    method,
    params,
});

// fracpack String: u32 little-endian byte length, then UTF-8 bytes. host:db
// stores values base64-encoded in the Supervisor origin's localStorage.
const packedB64 = (s: string) => {
    const bytes = Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]).toString("base64");
};

// host:db bucket key for host:auth's persistent, non-transactional
// `query_tokens-<user>` bucket (see Host/plugin/db/src/bucket.rs).
async function tokenKey(
    devnet: { get: (s: string, p: string) => Promise<{ body: string }> },
    user: string,
) {
    const chainId = JSON.parse(
        (await devnet.get("supervisor", "/common/chainid")).body,
    );
    return `${chainId}:non-trx:host:query_tokens-${user}:${APP}`;
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

const storage = (sup: SupervisorHandle) => ({
    get: (k: string) =>
        sup.frame.evaluate((key) => localStorage.getItem(key), k),
    set: (k: string, v: string) =>
        sup.frame.evaluate(([key, val]) => localStorage.setItem(key, val), [
            k,
            v,
        ] as const),
    remove: (k: string) =>
        sup.frame.evaluate((key) => localStorage.removeItem(key), k),
});

const expectOk = (raw: unknown) => {
    const r = replyObject(raw as never);
    expect(r.noReply, "Supervisor never replied").toBeUndefined();
    expect(r.isError, `${r.name}: ${r.message}`).toBeUndefined();
    expect(r.name, `${r.name}: ${r.message}`).toBeUndefined();
};

test("resource constructor + method from a JSPI-compiled plugin return correct values", async ({
    devnet,
    supervisor,
}) => {
    // Runs on both paths: under JSPI host:auth's export is promising (the
    // resource proxy runs inside it, no suspension); without JSPI it is the
    // sync regression check.
    const user = `e2erp${Date.now()}`;
    const key = await tokenKey(devnet, user);
    const st = storage(supervisor);
    await st.set(key, packedB64("tok-read"));
    try {
        expect(
            await supervisor.call(auth("getActiveQueryToken", [APP, user])),
        ).toBe("tok-read");
        // A bucket with no entry: option::none, not a Promise or a handle.
        expect(
            (await supervisor.call(
                auth("getActiveQueryToken", ["nosuchapp", user]),
            )) ?? null,
        ).toBeNull();
    } finally {
        await st.remove(key);
    }
});

test.describe("across a JSPI suspension", () => {
    test.beforeEach(async ({ supervisor }) => {
        test.skip(
            !(await jspiAvailable(supervisor.frame)),
            "needs WebAssembly JSPI (WebAssembly.Suspending); the sync XHR path never suspends",
        );
    });

    test("Bucket::new + set after resumption write the right key and value", async ({
        devnet,
        supervisor,
    }) => {
        const user = `e2erp${Date.now()}`;
        const token = `tok-set-${Date.now()}`;
        const key = await tokenKey(devnet, user);
        const st = storage(supervisor);
        const path = "/common/set-auth-cookie";
        await st.set(key, packedB64(token));
        devnet.proxy.stubs.set(path, { ms: 1500 });
        try {
            const hits0 = devnet.proxy.stubHits.length;
            const pending = supervisor.callRaw(
                auth("setLoggedInUser", [user, APP]),
            );
            await expect
                .poll(() => devnet.proxy.inflight.has(path), {
                    timeout: 10_000,
                })
                .toBe(true);

            // Suspended mid-call: the frame runs JS right away, and we remove
            // the stored token. Only the post-resumption Bucket::new + set can
            // put it back.
            const t0 = Date.now();
            await st.remove(key);
            expect(Date.now() - t0, "Supervisor frame blocked").toBeLessThan(
                500,
            );
            expect(await st.get(key)).toBeNull();

            expectOk(await pending);

            const hits = devnet.proxy.stubHits
                .slice(hits0)
                .filter((h) => h.path === path);
            expect(hits).toHaveLength(1);
            expect(hits[0].method).toBe("POST");
            // Pre-suspension Bucket::new + get read the seeded token.
            expect(JSON.parse(hits[0].body).accessToken).toBe(token);

            // Post-resumption Bucket::new + set: same key (so get-sender and
            // the chain id were right), same value.
            expect(await st.get(key)).toBe(packedB64(token));
            expect(
                await supervisor.call(auth("getActiveQueryToken", [APP, user])),
            ).toBe(token);
        } finally {
            devnet.proxy.stubs.delete(path);
            await st.remove(key);
        }
    });

    test("Bucket::new + delete after resumption remove the entry", async ({
        devnet,
        supervisor,
    }) => {
        const user = `e2erp${Date.now()}`;
        const key = await tokenKey(devnet, user);
        const st = storage(supervisor);
        const path = "/common/remove-auth-cookie";
        await st.set(key, packedB64("tok-del"));
        devnet.proxy.stubs.set(path, { ms: 1000 });
        try {
            const pending = supervisor.callRaw(auth("logOutUser", [user, APP]));
            await expect
                .poll(() => devnet.proxy.inflight.has(path), {
                    timeout: 10_000,
                })
                .toBe(true);
            // Still there while suspended (delete runs after resumption).
            expect(await st.get(key)).toBe(packedB64("tok-del"));

            expectOk(await pending);

            expect(await st.get(key)).toBeNull();
            expect(
                (await supervisor.call(
                    auth("getActiveQueryToken", [APP, user]),
                )) ?? null,
            ).toBeNull();
        } finally {
            devnet.proxy.stubs.delete(path);
            await st.remove(key);
        }
    });

    const probe = (
        plugin: "e2e-probe" | "e2e-probe-user",
        method: string,
        params: unknown[],
    ): CallArgs => ({ service: "host", plugin, intf: "api", method, params });

    test("bucket held across a suspension stays valid (host:e2e-probe)", async ({
        devnet,
        supervisor,
    }) => {
        // bucket-across-fetch: let b = Bucket::new(..); send-request (suspends);
        // b.set(key, value); b.get(key).
        const tag = `probe-bucket-${Date.now()}`;
        const key = `k${Date.now()}`;
        const value = `v-${tag}`;
        const chainId = JSON.parse(
            (await devnet.get("supervisor", "/common/chainid")).body,
        );
        const lsKey = `${chainId}:non-trx:host:e2e_probe:${key}`;
        const st = storage(supervisor);
        try {
            const pending = supervisor.callRaw(
                probe("e2e-probe", "bucketAcrossFetch", [
                    `/__e2e/sleep?ms=800&tag=${tag}`,
                    key,
                    value,
                ]),
            );
            if (await inflightOrReply(devnet.proxy.inflight, tag, pending))
                // Nothing written yet while suspended.
                expect(await st.get(lsKey)).toBeNull();
            const r = await pending;
            test.info().annotations.push({
                type: "bucket-reply",
                description: JSON.stringify(r)?.slice(0, 300) ?? String(r),
            });
            const o = replyObject(r);
            expect(o.noReply, "Supervisor never replied").toBeUndefined();
            expect(o.isError, `${o.name}: ${o.message}`).toBeUndefined();
            expect(r).toBe(value);
            expect(await st.get(lsKey)).toBe(
                Buffer.from(value).toString("base64"),
            );
        } finally {
            await st.remove(lsKey);
        }
    });

    // host:e2e-probe-user calls the probe's resources through the
    // Supervisor's import-side addResourceProxy. Today collectJspiExportNames
    // makes resource METHODS promising (constructors are excluded), and the
    // proxy is a sync JS function, so these probe whether a real value or a
    // Promise / SuspendError comes back. Desired: real values.
    test("resource method that suspends returns its value through addResourceProxy", async ({
        devnet,
        supervisor,
    }) => {
        const tag = `probe-lazy-${Date.now()}`;
        const r = await supervisor.callRaw(
            probe("e2e-probe-user", "lazyFetch", [
                `/__e2e/sleep?ms=300&tag=${tag}`,
            ]),
        );
        const o = replyObject(r);
        test.info().annotations.push({
            type: "lazy-reply",
            description: JSON.stringify(r)?.slice(0, 300) ?? String(r),
        });
        expect(o.noReply, "Supervisor never replied").toBeUndefined();
        expect(o.isError, `${o.name}: ${o.message}`).toBeUndefined();
        expect(o.name, `${o.name}: ${o.message}`).toBeUndefined();
        expect(JSON.parse(r as string).tag).toBe(tag);
        expect(devnet.proxy.sleeps.filter((s) => s.tag === tag)).toHaveLength(
            1,
        );
    });

    test("resource constructor that suspends yields a real handle through addResourceProxy", async ({
        devnet,
        supervisor,
    }) => {
        const tag = `probe-eager-${Date.now()}`;
        const r = await supervisor.callRaw(
            probe("e2e-probe-user", "eagerBody", [
                `/__e2e/sleep?ms=300&tag=${tag}`,
            ]),
        );
        const o = replyObject(r);
        test.info().annotations.push({
            type: "eager-reply",
            description: JSON.stringify(r)?.slice(0, 300) ?? String(r),
        });
        expect(o.noReply, "Supervisor never replied").toBeUndefined();
        expect(o.isError, `${o.name}: ${o.message}`).toBeUndefined();
        expect(o.name, `${o.name}: ${o.message}`).toBeUndefined();
        expect(JSON.parse(r as string).tag).toBe(tag);
        expect(devnet.proxy.sleeps.filter((s) => s.tag === tag)).toHaveLength(
            1,
        );
    });
});
