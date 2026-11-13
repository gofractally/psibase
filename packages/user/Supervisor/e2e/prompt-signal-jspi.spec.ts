import {
    test,
    expect,
    jspiAvailable,
    replyObject,
    type CallArgs,
} from "../../../../e2e/fixtures";

// Phase 0 open question (wasm-async-fetches.md, "Cloud agent clarification",
// section 2, `PromptSignal` row, marked unverified):
//
//   A throw from a Suspending import rejects the promise and unwinds through
//   the promising export. Do the `instanceof PromptSignal` checks in
//   Supervisor `entry` still see the original object, not a wrapped
//   WebAssembly.Exception / RuntimeError? The instance is poisoned after a
//   trap, so `disposeAll()` in `finally` must stay.
//
// These specs assert the DESIRED behavior from the plan. A failure here is an
// answer to the open question, not necessarily a harness bug.
//
// Only service "host" plugins are privileged (plugin.ts), and of the real
// ones only host:http and host:auth call `send-request` (JSPI-compiled);
// neither calls host:prompt. The direct case, "PromptSignal thrown inside a
// JSPI-promising export after it resumed", uses the TEST-ONLY probe plugin
// host:e2e-probe (packages/user/Host/plugin/e2e-probe), which must be in the
// test chain's Host package. Also covered: rejections and traps that unwind
// through a promising export after a real suspension, and prompts requested
// in the same Supervisor session after / queued behind one.

const getJson = (endpoint: string): CallArgs => ({
    service: "host",
    plugin: "http",
    intf: "api",
    method: "getJson",
    params: [endpoint],
});

// host:accounts active-app connect-account -> host:prompt prompt -> bridge
// request-prompt -> Supervisor.requestPrompt() throws PromptSignal("prompt").
// That is the real-world prompt path apps use.
const connectAccount: CallArgs = {
    service: "host",
    plugin: "accounts",
    intf: "activeApp",
    method: "connectAccount",
    params: [],
};

const expectPromptRedirect = (raw: unknown) => {
    const r = replyObject(raw as never);
    expect(r.noReply, "Supervisor never replied").toBeUndefined();
    expect(
        r.isError,
        `PromptSignal was not recognized; entry replied with ${r.name}: ${r.message}`,
    ).toBeUndefined();
    expect(r.name).toBe("RedirectErrorObject");
    expect(r.message).toBe("user_prompt_request");
    expect(r.pluginId).toEqual({ service: "host", plugin: "prompt" });
};

test.beforeEach(async ({ supervisor }) => {
    test.skip(
        !(await jspiAvailable(supervisor.frame)),
        "needs WebAssembly JSPI (WebAssembly.Suspending); the sync XHR path never suspends",
    );
});

test.describe("rejection after a JSPI suspension", () => {
    for (const mode of ["reset", "500"] as const) {
        test(`fetch suspends, then fails (${mode}): recoverable PluginErrorObject, later calls work`, async ({
            devnet,
            supervisor,
        }) => {
            const path = `/__e2e/reject-${mode}-${Date.now()}`;
            devnet.proxy.stubs.set(
                path,
                mode === "reset"
                    ? { ms: 1000, reset: true }
                    : {
                          ms: 1000,
                          status: 500,
                          body: "e2e-boom",
                          contentType: "text/plain",
                      },
            );
            try {
                const pending = supervisor.callRaw(getJson(path));
                // The fetch is in flight on the server...
                await expect
                    .poll(() => devnet.proxy.inflight.has(path), {
                        timeout: 10_000,
                    })
                    .toBe(true);
                // ...and the Supervisor frame's event loop is free, i.e. the
                // Wasm call is suspended (a sync XHR would block this).
                const t0 = Date.now();
                await supervisor.frame.evaluate(() => 1);
                expect(
                    Date.now() - t0,
                    "Supervisor frame blocked",
                ).toBeLessThan(500);

                const r = replyObject(await pending);
                expect(r.noReply, "Supervisor never replied").toBeUndefined();
                // Not a raw RuntimeError / WebAssembly.Exception: the bridge's
                // recoverable error survived the promise rejection and
                // getRecoverableError still detects it.
                expect(
                    r.isError,
                    `unrecognized error reply ${r.name}: ${r.message}`,
                ).toBeUndefined();
                expect(r.name).toBe("PluginErrorObject");
                expect(r.pluginId).toEqual({
                    service: "host",
                    plugin: "client",
                });
                expect(r.message).toMatch(/^Http request error/);
                if (mode === "500") expect(r.message).toContain("e2e-boom");
            } finally {
                devnet.proxy.stubs.delete(path);
            }

            // disposeAll ran and the next session re-instantiates cleanly.
            const tag = `after-reject-${mode}-${Date.now()}`;
            const ok = await supervisor.call(
                getJson(`/__e2e/sleep?ms=50&tag=${tag}`),
            );
            expect(JSON.parse(ok as string).tag).toBe(tag);
        });
    }
});

test.describe("prompts around a JSPI suspension", () => {
    test("prompt requested after a JSPI fetch resumed is still a PromptSignal", async ({
        supervisor,
    }) => {
        const tag = `pre-prompt-${Date.now()}`;
        const r1 = await supervisor.call(
            getJson(`/__e2e/sleep?ms=300&tag=${tag}`),
        );
        expect(JSON.parse(r1 as string).tag).toBe(tag);

        expectPromptRedirect(await supervisor.callRaw(connectAccount));

        // Neither the suspension nor the prompt unwind left anything behind.
        const tag2 = `post-prompt-${Date.now()}`;
        const r2 = await supervisor.call(
            getJson(`/__e2e/sleep?ms=50&tag=${tag2}`),
        );
        expect(JSON.parse(r2 as string).tag).toBe(tag2);
        expectPromptRedirect(await supervisor.callRaw(connectAccount));
    });

    test("prompt queued while a fetch is suspended unwinds only its own call", async ({
        devnet,
        supervisor,
    }) => {
        const tag = `queued-${Date.now()}`;
        const order: string[] = [];
        const fetchP = supervisor
            .callRaw(getJson(`/__e2e/sleep?ms=1500&tag=${tag}`))
            .then((r) => (order.push("fetch"), r));
        await expect
            .poll(() => devnet.proxy.inflight.has(tag), { timeout: 10_000 })
            .toBe(true);
        // Sent while the first call is suspended inside the Wasm stack. The
        // Supervisor's serialize queue must hold it until the fetch finishes;
        // its PromptSignal must not unwind (or be swallowed by) the suspended
        // call.
        const promptP = supervisor
            .callRaw(connectAccount)
            .then((r) => (order.push("prompt"), r));

        const fetchRes = await fetchP;
        expect(JSON.parse(fetchRes as string).tag).toBe(tag);
        expectPromptRedirect(await promptP);
        expect(order).toEqual(["fetch", "prompt"]);
    });
});

test.describe("trap after a JSPI suspension", () => {
    // host:auth log-out-user only accepts caller "host", so serve the harness
    // page from the host subdomain (the proxy serves it on any subdomain).
    test.use({ harnessApp: "host" });

    const logOut = (user: string): CallArgs => ({
        service: "host",
        plugin: "auth",
        intf: "api",
        method: "logOutUser",
        params: [user, "network"],
    });

    test("panic after resumption replies with an error; disposeAll keeps later calls working", async ({
        devnet,
        supervisor,
    }) => {
        const user = `e2etrap${Date.now()}`;
        const path = "/common/remove-auth-cookie";
        // host:auth does `send_request(..).unwrap()`, so a failed fetch after
        // the suspension panics -> trap through the promising export.
        devnet.proxy.stubs.set(path, { ms: 800, reset: true });
        try {
            const r = replyObject(await supervisor.callRaw(logOut(user)));
            test.info().annotations.push({
                type: "trap-reply",
                description: `${r.name}: ${r.message}`,
            });
            expect(r.noReply, "Supervisor never replied").toBeUndefined();
            expect(r.isError || /ErrorObject$/.test(r.name ?? "")).toBeTruthy();
            expect(r.name).not.toBe("RedirectErrorObject");
        } finally {
            devnet.proxy.stubs.delete(path);
        }

        // The poisoned instance was disposed: a fresh one works, both for a
        // different JSPI plugin and for host:auth itself.
        const tag = `after-trap-${Date.now()}`;
        const ok = await supervisor.call(
            getJson(`/__e2e/sleep?ms=50&tag=${tag}`),
        );
        expect(JSON.parse(ok as string).tag).toBe(tag);

        devnet.proxy.stubs.set(path, { ms: 0 });
        try {
            const r2 = replyObject(await supervisor.callRaw(logOut(user)));
            expect(r2.noReply).toBeUndefined();
            expect(r2.isError, `${r2.name}: ${r2.message}`).toBeUndefined();
            expect(r2.name).toBeUndefined();
        } finally {
            devnet.proxy.stubs.delete(path);
        }
    });
});

test.describe("prompt inside a JSPI-promising export (host:e2e-probe)", () => {
    // host:e2e-probe fetch-then-prompt: send-request (suspends), then after it
    // resumed host:prompt prompt -> bridge request-prompt -> PromptSignal,
    // thrown through host:prompt's instance and the probe's promising export.
    test("PromptSignal thrown after resumption reaches entry as the original object", async ({
        devnet,
        supervisor,
    }) => {
        const tag = `probe-prompt-${Date.now()}`;
        const pending = supervisor.callRaw({
            service: "host",
            plugin: "e2e-probe",
            intf: "api",
            method: "fetchThenPrompt",
            params: [`/__e2e/sleep?ms=800&tag=${tag}`],
        });
        await expect
            .poll(() => devnet.proxy.inflight.has(tag), { timeout: 10_000 })
            .toBe(true);
        expectPromptRedirect(await pending);
        // The fetch did complete before the prompt was raised.
        expect(devnet.proxy.sleeps.filter((s) => s.tag === tag)).toHaveLength(
            1,
        );

        // disposeAll ran; the next calls (probe and host:http) work.
        const tag2 = `after-probe-prompt-${Date.now()}`;
        const ok = await supervisor.call(
            getJson(`/__e2e/sleep?ms=50&tag=${tag2}`),
        );
        expect(JSON.parse(ok as string).tag).toBe(tag2);
        expectPromptRedirect(
            await supervisor.callRaw({
                service: "host",
                plugin: "e2e-probe",
                intf: "api",
                method: "fetchThenPrompt",
                params: [`/__e2e/sleep?ms=50&tag=${tag2}-again`],
            }),
        );
    });
});
