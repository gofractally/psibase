import { test as base, expect, type Frame, type Page } from "@playwright/test";
import { generateKeyPairSync, randomInt } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevnet, type Devnet } from "./devnet";

export { expect };

export interface CallArgs {
    service: string;
    plugin?: string;
    intf?: string;
    method: string;
    params: unknown[];
}

/** Test-side handle on the Supervisor running in the harness page. */
export interface SupervisorHandle {
    page: Page;
    /** The Supervisor iframe (for observing/driving it from the test side). */
    frame: Frame;
    /** Call any plugin function through the Supervisor. Throws on plugin/generic errors. */
    call: (args: CallArgs) => Promise<unknown>;
    /** Load (preload) plugins by service/plugin id. */
    loadPlugins: (plugins: { service: string; plugin?: string }[]) => Promise<void>;
}

export interface ThrowawayAccount {
    name: string;
    publicKeyPem: string;
    privateKeyPath: string;
}

type WorkerFixtures = { devnet: Devnet };
type TestFixtures = {
    /** App subdomain the harness page is served from (the calling app). */
    harnessApp: string;
    supervisor: SupervisorHandle;
    throwawayAccount: ThrowawayAccount;
};

const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 28080);

export const test = base.extend<TestFixtures, WorkerFixtures>({
    // One isolated chain per worker: its own data dir, psinode port and proxy
    // port. parallelIndex is unique among concurrently running workers, so the
    // chromium and webkit jobs never share ports or endpoints.
    devnet: [
        async ({}, use, workerInfo) => {
            const p = PORT_BASE + workerInfo.parallelIndex * 10;
            const net = await startDevnet(p, p + 1);
            console.log(`[e2e] worker ${workerInfo.parallelIndex} (${workerInfo.project.name}): devnet on :${p}, proxy :${p + 1}, boot ${net.bootMs} ms`);
            await use(net);
            await net.stop();
        },
        { scope: "worker", timeout: 180_000 },
    ],

    harnessApp: "network",

    supervisor: async ({ page, devnet, harnessApp }, use, testInfo) => {
        const log: string[] = [];
        page.on("console", (m) => log.push(`[console.${m.type()}] ${m.text()}`));
        page.on("response", (r) => log.push(`[response] ${r.status()} ${r.url()}`));
        page.on("requestfailed", (r) => log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
        await page.goto(`${devnet.url(harnessApp)}/__e2e/harness.html`);
        try {
            await page.evaluate(() =>
                Promise.race([
                    (window as any).e2e.ready,
                    new Promise((_, rej) => setTimeout(() => rej(new Error("Supervisor did not initialize within 30 s")), 30_000)),
                ]),
            );
        } catch (e) {
            await testInfo.attach("browser-log", { body: log.join("\n"), contentType: "text/plain" });
            throw e;
        }
        const frame = page.frames().find((f) => f.url().startsWith(`${devnet.url("supervisor")}`));
        if (!frame) throw new Error("Supervisor iframe not found");

        const call = async (args: CallArgs) => {
            const result: any = await page.evaluate((a) => (window as any).e2e.call(a), args);
            if (result && typeof result === "object" && typeof result.name === "string" && /ErrorObject$/.test(result.name)) {
                throw new Error(`${result.name}: ${result.message}`);
            }
            return result;
        };
        const loadPlugins = async (plugins: { service: string; plugin?: string }[]) => {
            await page.evaluate(
                (ps) => (window as any).e2e.preload(ps),
                plugins.map((p) => ({ service: p.service, plugin: p.plugin ?? "plugin" })),
            );
        };
        await use({ page, frame, call, loadPlugins });
        if (testInfo.status !== testInfo.expectedStatus)
            await testInfo.attach("browser-log", { body: log.join("\n"), contentType: "text/plain" });
    },

    // Create -> use -> discard. A fresh P-256 keypair per test, an account on
    // this worker's chain secured by that key, and the key material deleted
    // afterwards. Nothing is read from secrets or the environment.
    throwawayAccount: async ({ devnet }, use) => {
        const dir = mkdtempSync(join(tmpdir(), "psibase-e2e-key-"));
        try {
            const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
            const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
            const pubPath = join(dir, "pub.pem");
            const privateKeyPath = join(dir, "priv.pem");
            writeFileSync(pubPath, publicKeyPem);
            writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
            const letters = "abcdefghijklmnopqrstuvwxyz";
            const name = "e" + Array.from({ length: 9 }, () => letters[randomInt(26)]).join("");
            await devnet.psibase(["create", name, "-k", pubPath]);
            // Funding: not needed by current specs (http fetches cost nothing).
            // Add a token transfer here when a spec needs a funded account.
            await use({ name, publicKeyPem, privateKeyPath });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
});

export interface LoopStats {
    /** Longest gap between 10 ms setInterval ticks (task-queue blocking). */
    maxTimerGapMs: number;
    /** Longest gap between requestAnimationFrame callbacks (rendering blocked). */
    maxFrameGapMs: number;
}

/**
 * Watch a page's or frame's event loop. Starts a 10 ms timer and a
 * requestAnimationFrame loop in that context; stop() returns the longest gap
 * seen by each. A synchronous XHR (or any long task) on that context's main
 * thread shows up as a gap roughly as long as the request.
 */
export async function watchEventLoop(target: Page | Frame) {
    await target.evaluate(() => {
        const w = window as any;
        const st = (w.__e2eLoop = { lastT: performance.now(), lastF: performance.now(), maxT: 0, maxF: 0, run: true, timer: 0 as any });
        st.timer = setInterval(() => {
            const now = performance.now();
            st.maxT = Math.max(st.maxT, now - st.lastT);
            st.lastT = now;
        }, 10);
        const frame = (now: number) => {
            if (!st.run) return;
            st.maxF = Math.max(st.maxF, now - st.lastF);
            st.lastF = now;
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
    return (): Promise<LoopStats> =>
        target.evaluate(() => {
            const st = (window as any).__e2eLoop;
            st.run = false;
            clearInterval(st.timer);
            const now = performance.now();
            return { maxTimerGapMs: Math.max(st.maxT, now - st.lastT), maxFrameGapMs: Math.max(st.maxF, now - st.lastF) };
        });
}
