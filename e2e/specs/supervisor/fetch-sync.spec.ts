import { test, expect } from "../../fixtures";

// SYNC fetch path. Passes today (the bridge's send-request uses synchronous
// XHR). After the JSPI work lands this is the regression test for the retained
// sync XHR fallback used by browsers without JSPI (older Safari/iOS); run it
// there, or with JSPI disabled, to cover that path.
test("plugin fetch via host:http returns the correct response", async ({ devnet, supervisor }) => {
    const tag = `sync-${Date.now()}`;
    const res = await supervisor.call({
        service: "host",
        plugin: "http",
        intf: "api",
        method: "getJson",
        params: [`/__e2e/sleep?ms=300&tag=${tag}`],
    });
    const body = JSON.parse(res as string);
    expect(body.tag).toBe(tag);
    expect(body.ms).toBe(300);
    expect(body.end - body.start).toBeGreaterThanOrEqual(290);
    // The request really reached this worker's server, exactly once.
    expect(devnet.proxy.sleeps.filter((s) => s.tag === tag)).toHaveLength(1);

    // Several fetches in a row come back in order with the right bodies.
    const tags = ["a", "b", "c"].map((t) => `${tag}-${t}`);
    for (const t of tags) {
        const r = JSON.parse((await supervisor.call({
            service: "host", plugin: "http", intf: "api", method: "getJson",
            params: [`/__e2e/sleep?ms=50&tag=${t}`],
        })) as string);
        expect(r.tag).toBe(t);
    }
});
