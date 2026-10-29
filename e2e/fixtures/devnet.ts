import { spawn, execFile, type ChildProcess } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { startProxy, type E2eProxy } from "./proxy";

const execFileP = promisify(execFile);

export interface Devnet {
    /** Root host the browser uses, e.g. `psibase.localhost:28081`. */
    rootHost: string;
    /** `http://<sub>.psibase.localhost:<proxyPort>` */
    url: (subdomain?: string) => string;
    /** Direct psinode endpoint (bypasses the proxy); for the CLI. */
    apiUrl: string;
    proxy: E2eProxy;
    producer: string;
    /**
     * GET from Node via the proxy, with the right Host header. (Node's resolver
     * does not map *.localhost to loopback, so we never rely on DNS here.)
     */
    get: (subdomain: string, path: string) => Promise<{ status: number; body: string }>;
    /** Run the `psibase` CLI against this chain. */
    psibase: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
    bootMs: number;
}

const ROOT = "psibase.localhost";
const PRODUCER = "prod";

/**
 * Locate psinode/psibase. Order: $PSIDK_BIN, the repo's own build/ dir,
 * a release psidk unpacked under e2e/.cache/psidk, then $PATH.
 */
export function findBin(name: "psinode" | "psibase"): string {
    const candidates = [
        process.env.PSIDK_BIN && join(process.env.PSIDK_BIN, name),
        resolve(__dirname, "../../build", name),
        resolve(__dirname, "../.cache/psidk/bin", name),
    ].filter(Boolean) as string[];
    for (const c of candidates) if (existsSync(c)) return c;
    return name; // fall back to $PATH
}

/** Package source: $PSIBASE_PACKAGES, else <psidk>/share/psibase/packages next to bin. */
function packageSource(psibaseBin: string): string | undefined {
    if (process.env.PSIBASE_PACKAGES) return process.env.PSIBASE_PACKAGES;
    const guess = resolve(psibaseBin, "../../share/psibase/packages");
    return existsSync(guess) ? guess : undefined;
}

function probe(port: number, host: string): Promise<number> {
    return new Promise((resolve) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/", headers: { Host: host } }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
        });
        req.on("error", () => resolve(0));
        req.setTimeout(2000, () => req.destroy());
    });
}

async function waitForHttp(port: number, host: string, timeoutMs: number, isDead: () => boolean) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const status = await probe(port, host);
        if (status > 0 && status < 500) return;
        if (isDead()) throw new Error(`psinode exited during startup (run with E2E_PSINODE_LOG=1)`);
        if (Date.now() > deadline) throw new Error(`psinode did not come up on port ${port} (last status ${status})`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

/** Boot a throwaway devnet + proxy on the given ports. */
export async function startDevnet(psinodePort: number, proxyPort: number): Promise<Devnet & { stop: () => Promise<void> }> {
    const psinodeBin = findBin("psinode");
    const psibaseBin = findBin("psibase");
    const dataDir = mkdtempSync(join(tmpdir(), "psibase-e2e-"));
    const apiUrl = `http://${ROOT}:${psinodePort}`;

    if ((await probe(psinodePort, ROOT)) !== 0 || (await probe(proxyPort, ROOT)) !== 0)
        throw new Error(`port ${psinodePort} or ${proxyPort} already in use (stale psinode? set E2E_PORT_BASE)`);

    const t0 = Date.now();
    const node: ChildProcess = spawn(
        psinodeBin,
        [dataDir, "-p", PRODUCER, "-o", ROOT, "-l", String(psinodePort)],
        { stdio: ["ignore", "ignore", process.env.E2E_PSINODE_LOG ? "inherit" : "ignore"] },
    );
    let exited = false;
    const killOnExit = () => node.kill("SIGKILL");
    process.on("exit", killOnExit);
    node.on("exit", () => {
        exited = true;
        process.off("exit", killOnExit);
    });
    const abort = () => {
        if (!exited) node.kill("SIGKILL");
        rmSync(dataDir, { recursive: true, force: true });
    };
    node.on("error", (e) => console.error(`[e2e] failed to start ${psinodeBin}: ${e.message} (set PSIDK_BIN, see README)`));

    const psibase = (args: string[]) =>
        execFileP(psibaseBin, [args[0], "-a", apiUrl, ...args.slice(1)], { maxBuffer: 16 << 20 });

    let proxy: E2eProxy;
    let bootMs: number;
    try {
        await waitForHttp(psinodePort, ROOT, 30_000, () => exited);
        const src = packageSource(psibaseBin);
        await psibase(["boot", "-p", PRODUCER, ...(src ? ["--package-source", src] : [])]);
        // `psibase boot` can return while the last boot blocks are still being
        // applied; the Supervisor app 404s until then. Wait for it.
        const deadline = Date.now() + 60_000;
        while ((await probe(psinodePort, `supervisor.${ROOT}`)) !== 200) {
            if (Date.now() > deadline) throw new Error("Supervisor app never became available after boot");
            await new Promise((r) => setTimeout(r, 200));
        }
        bootMs = Date.now() - t0;
        proxy = await startProxy(proxyPort, psinodePort);
    } catch (e) {
        abort();
        throw e;
    }
    const rootHost = `${ROOT}:${proxyPort}`;

    return {
        rootHost,
        url: (sub?: string) => `http://${sub ? sub + "." : ""}${rootHost}`,
        apiUrl,
        proxy,
        producer: PRODUCER,
        psibase,
        bootMs,
        get: (sub, path) =>
            new Promise((resolve, reject) => {
                const req = http.get(
                    { host: "127.0.0.1", port: proxyPort, path, headers: { Host: `${sub}.${rootHost}`, Accept: "application/json" } },
                    (res) => {
                        let body = "";
                        res.setEncoding("utf8");
                        res.on("data", (c) => (body += c));
                        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
                    },
                );
                req.on("error", reject);
            }),
        stop: async () => {
            await proxy.close();
            if (!exited) {
                node.kill("SIGTERM");
                await new Promise((r) => setTimeout(r, 500));
                if (!exited) node.kill("SIGKILL");
            }
            abort();
        },
    };
}
