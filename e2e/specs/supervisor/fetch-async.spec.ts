import { test, expect, watchEventLoop } from "../../fixtures";

// ASYNC fetch: the UI stays responsive while a plugin fetch is in flight.
//
// What this measures, and why: today the bridge's `send-request` uses a
// synchronous XHR inside the Supervisor iframe. A sync XHR blocks the main
// thread of the context that issued it, and that thread is shared with the
// app page in both browsers here: supervisor.<root> and <app>.<root> are
// cross-origin but SAME-SITE (both under psibase.localhost), so Chromium's
// site isolation keeps them in one renderer process / main thread, and
// WebKit runs the whole page in one web process anyway. So during a 2 s
// fetch, today, BOTH the Supervisor frame and the top-level app page stop
// running timers, stop producing animation frames, and can't handle input.
// (The test records the numbers for both contexts; see the annotations.)
//
// With JSPI-backed fetch the Wasm call suspends and the main thread is free,
// so all of this keeps ticking. This depends only on that; it does NOT need
// two calls to overlap, so it is valid with the Supervisor's `serialize`
// queue still in place (which is the plan for this round).
//
// EXPECTED TO FAIL TODAY: marked test.fail() so the suite is green until the
// JSPI work lands. When it starts passing Playwright reports "expected to
// fail, but passed": remove test.fail() then.
const SLEEP = 2000;
const BUDGET = 500; // generous; idle gaps are ~10-60 ms

test("UI stays responsive while a plugin fetch is in flight", async ({ devnet, supervisor }) => {
    test.fail(true, "needs JSPI-backed async send-request (wasm-async step 1)");
    const { page, frame } = supervisor;
    const tag = `async-${Date.now()}`;

    const stopApp = await watchEventLoop(page);
    const stopSup = await watchEventLoop(frame);
    await page.evaluate(() => ((window as any).__e2eClicks = []));

    // Start the fetch without awaiting it (the page-side promise is held in
    // the page; we only await it at the end).
    await page.evaluate((t) => {
        (window as any).__e2ePending = (window as any).e2e.call({
            service: "host", plugin: "http", intf: "api", method: "getJson",
            params: [`/__e2e/sleep?ms=${t.ms}&tag=${t.tag}`],
        });
    }, { ms: SLEEP, tag });
    // Wait until the server has actually received the request, then poke the UI.
    await expect.poll(() => devnet.proxy.inflight.has(tag), { timeout: 10_000 }).toBe(true);

    const t0 = Date.now();
    await page.mouse.click(70, 30); // the harness page's input-probe button
    const clickRoundTrip = Date.now() - t0;

    const res = await page.evaluate(() => (window as any).__e2ePending);
    const app = await stopApp();
    const sup = await stopSup();
    const clicks: { latency: number }[] = await page.evaluate(() => (window as any).__e2eClicks);

    const stats = {
        appTimerGap: app.maxTimerGapMs, appFrameGap: app.maxFrameGapMs,
        supTimerGap: sup.maxTimerGapMs, supFrameGap: sup.maxFrameGapMs,
        clickLatency: clicks[0]?.latency ?? -1, clickRoundTrip,
    };
    const fmt = Object.entries(stats).map(([k, v]) => `${k}=${v.toFixed(0)}ms`).join(" ");
    test.info().annotations.push({ type: "responsiveness", description: fmt });
    console.log(`[e2e] ${test.info().project.name}: during ${SLEEP} ms fetch: ${fmt}`);

    // Response still correct (same as the sync path).
    expect(JSON.parse(res as string).tag).toBe(tag);
    expect(clicks).toHaveLength(1);
    // Primary (app page) main thread: timers, rendering and input keep going.
    expect.soft(stats.appTimerGap, "app page timer stall").toBeLessThan(BUDGET);
    expect.soft(stats.appFrameGap, "app page rAF stall").toBeLessThan(BUDGET);
    // Input: time from the test sending a real mouse click until the browser
    // reports it dispatched to the page (handled). event.timeStamp is NOT
    // used for this: browsers stamp the event when the renderer gets to it,
    // so it hides the wait behind a blocked thread (clickLatency, ~5-10 ms
    // even today, is recorded for information only).
    expect.soft(stats.clickRoundTrip, "click round trip").toBeLessThan(BUDGET);
    // Supervisor frame: its event loop keeps running while the call waits.
    expect.soft(stats.supTimerGap, "Supervisor timer stall").toBeLessThan(BUDGET);
});
