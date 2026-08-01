import { expect, test } from "../fixtures/chain";

/**
 * Diagnostic-only spec: captures every console message, page error, request
 * failure, and the supervisor-iframe handshake during a 90-second window.
 *
 * Opt-in (skipped in default `yarn e2e`):
 *   PSIBASE_E2E_DIAG_AUTH=1 yarn e2e e2e/tests/diag-auth-shell.spec.ts
 *   PSIBASE_E2E_EXTERNAL_CHAIN=1 PSIBASE_E2E_DIAG_AUTH=1 yarn e2e e2e/tests/diag-auth-shell.spec.ts
 */
test.skip(
    process.env.PSIBASE_E2E_DIAG_AUTH !== "1",
    "Opt-in: set PSIBASE_E2E_DIAG_AUTH=1",
);

test("diag: capture supervisor init signal and any errors", async ({
    chain,
    alicePage,
}) => {
    const startedAt = Date.now();
    const ts = () =>
        `+${(Date.now() - startedAt).toString().padStart(5, " ")}ms`;

    alicePage.on("console", (msg) => {
        console.log(`${ts()} [console:${msg.type()}]`, msg.text());
    });
    alicePage.on("pageerror", (err) => {
        console.log(`${ts()} [pageerror]`, err.message);
    });
    alicePage.on("requestfailed", (req) => {
        console.log(
            `${ts()} [requestfailed] ${req.method()} ${req.url()} -> ${
                req.failure()?.errorText ?? "unknown"
            }`,
        );
    });
    alicePage.on("response", (res) => {
        if (res.status() >= 400) {
            console.log(
                `${ts()} [http ${res.status()}] ${res.request().method()} ${res.url()}`,
            );
        }
    });
    alicePage.on("frameattached", (frame) => {
        console.log(`${ts()} [frameattached]`, frame.url());
    });
    alicePage.on("framenavigated", (frame) => {
        console.log(`${ts()} [framenavigated]`, frame.url());
    });

    console.log(`${ts()} navigating to ${chain.baseUrl}`);
    await alicePage.goto(chain.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
    });
    console.log(`${ts()} dom content loaded; current url: ${alicePage.url()}`);

    // Install in-page hooks BEFORE supervisor finishes init so we can observe
    // postMessage traffic and the readiness flip.
    await alicePage.addInitScript(() => {
        // Already too late on first load (init script runs on next nav), but
        // harmless — we'll use page.evaluate below for the live page.
        (
            window as unknown as { __diagPostMessages: unknown[] }
        ).__diagPostMessages = [];
    });

    await alicePage.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__diagPostMessages = [];
        const log = (entry: unknown) => {
            (w.__diagPostMessages as unknown[]).push(entry);
        };
        window.addEventListener("message", (event) => {
            try {
                const data = event.data;
                let summary: unknown = data;
                if (typeof data === "object" && data !== null) {
                    summary = JSON.stringify(data).slice(0, 240);
                }
                log({
                    t: Date.now(),
                    origin: event.origin,
                    data: summary,
                });
            } catch (e) {
                log({ t: Date.now(), origin: event.origin, error: String(e) });
            }
        });
        // Surface unhandled promise rejections too — pageerror only catches
        // sync throws.
        window.addEventListener("unhandledrejection", (e) => {
            console.error(
                "[unhandledrejection]",
                e.reason instanceof Error ? e.reason.message : String(e.reason),
            );
        });
    });

    // Poll readiness signals for 90 seconds.
    const supervisorReady = async (): Promise<boolean> =>
        await alicePage.evaluate(() => {
            const iframe = document.getElementById(
                "iframe-supervisor",
            ) as HTMLIFrameElement | null;
            return Boolean(iframe);
        });

    const navUserText = async (): Promise<string> =>
        await alicePage
            .evaluate(() => {
                const el = document.body;
                return el ? el.innerText.slice(0, 400) : "";
            })
            .catch(() => "<eval failed>");

    const messageCount = async (): Promise<number> =>
        await alicePage
            .evaluate(() => {
                const w = window as unknown as Record<string, unknown>;
                const arr = w.__diagPostMessages as unknown[] | undefined;
                return arr ? arr.length : -1;
            })
            .catch(() => -1);

    for (let i = 0; i < 18; i++) {
        const iframe = await supervisorReady();
        const text = (await navUserText()).replace(/\s+/g, " ").slice(0, 160);
        const msgs = await messageCount();
        const sawNotLoggedIn = text.includes("Not logged in");
        const sawLoginButton = /\bLog in\b/.test(text);
        console.log(
            `${ts()} poll iframe=${iframe} msgs=${msgs} notLoggedIn=${sawNotLoggedIn} loginBtn=${sawLoginButton} text="${text}"`,
        );
        if (sawNotLoggedIn || sawLoginButton) break;
        await alicePage.waitForTimeout(5_000);
    }

    const dump = await alicePage
        .evaluate(() => {
            const w = window as unknown as Record<string, unknown>;
            const arr = w.__diagPostMessages as unknown[] | undefined;
            return arr ? arr.slice(0, 100) : [];
        })
        .catch(() => []);
    console.log(
        `${ts()} captured ${(dump as unknown[]).length} postMessage events`,
    );
    for (const entry of dump as unknown[]) {
        console.log(`${ts()} [postMessage]`, JSON.stringify(entry));
    }

    // Don't fail the test — the goal is the captured logs.
    expect(true).toBe(true);
});
