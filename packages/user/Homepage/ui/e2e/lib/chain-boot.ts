import { type ChildProcess, spawn } from "node:child_process";
import {
    existsSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Boot bundle that includes Packages registry, Accounts, Supervisor, Homepage, Chat, etc. */
const BOOT_PACKAGES = ["DevDefault"] as const;

/** Reinstall from the local package index so e2e runs freshly built Homepage/Chat artifacts. */
const DEFAULT_REINSTALL_PACKAGES = "Homepage,Chat";
const DEFAULT_LOCAL_PACKAGES = "XWebRtcSig";

const REINSTALL_PACKAGES = (
    process.env.PSIBASE_E2E_REINSTALL ?? DEFAULT_REINSTALL_PACKAGES
)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const LOCAL_PACKAGES = (
    process.env.PSIBASE_E2E_LOCAL_INSTALL ?? DEFAULT_LOCAL_PACKAGES
)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Set PSIBASE_E2E_SKIP_REINSTALL=1 to boot DevDefault and stop, without
 * reinstalling Homepage/Chat or installing XWebRtcSig. Used to isolate which
 * step makes the supervisor iframe initialize slowly.
 */
const SKIP_REINSTALL = process.env.PSIBASE_E2E_SKIP_REINSTALL === "1";

const REPO_ROOT = resolve(__dirname, "../../../../../../");

const DEFAULT_API_HOST = "psibase.localhost";
/** DevDefault Homepage postinstall redirects the SPA to the network branding host. */
const DEFAULT_BROWSER_HOST = "network.psibase.localhost";
const DEFAULT_PORT = 8080;

export type ChainBootOptions = {
    /** Host passed to `psibase boot -a` (API / package install). */
    apiHost?: string;
    /** Host the browser loads (Homepage SPA after redirect). */
    browserHost?: string;
    host?: string;
    port?: number;
    psinodePath?: string;
    psibasePath?: string;
    extraInstallPackages?: string[];
    bootTimeoutMs?: number;
    debug?: boolean;
};

export type ChainHandle = {
    /** Browser-facing host (Homepage SPA). */
    host: string;
    /** API host used for `psibase boot -a`. */
    apiHost: string;
    port: number;
    baseUrl: string;
    dbDir: string;
    /** PID of the spawned psinode process. */
    psinodePid: number;
    /** Log file when psinode stdio is redirected (debugging crashes). */
    psinodeLog?: string;
    stop: () => Promise<void>;
};

const stateFileEnv = "PSIBASE_E2E_STATE_FILE";
const runLockFileEnv = "PSIBASE_E2E_RUN_LOCK_FILE";

export const chainStateFile = (): string =>
    process.env[stateFileEnv] ??
    join(tmpdir(), "psibase-e2e-chain-state.json");

export const e2eRunLockFile = (): string =>
    process.env[runLockFileEnv] ??
    join(tmpdir(), "psibase-e2e-run.lock");

export type E2eRunLock = {
    ownerPid: number;
    startedAt: string;
    psinodePid?: number;
    psinodeLog?: string;
};

function isProcessAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readRunLock(): E2eRunLock | null {
    const lockFile = e2eRunLockFile();
    if (!existsSync(lockFile)) return null;
    try {
        return JSON.parse(readFileSync(lockFile, "utf8")) as E2eRunLock;
    } catch {
        return null;
    }
}

/**
 * Refuse to start a second Playwright e2e run while another setup process still
 * owns the lock (prevents globalSetup from killing an in-flight chain).
 */
export function assertNoConcurrentE2eRun(): void {
    const lock = readRunLock();
    if (!lock) return;
    if (!isProcessAlive(lock.ownerPid)) return;
    throw new Error(
        `Another Playwright e2e run is already active (setup pid ${lock.ownerPid}, started ${lock.startedAt}). ` +
            "Wait for it to finish or stop it before starting a new e2e suite.",
    );
}

export function writeE2eRunLock(lock: E2eRunLock): void {
    writeFileSync(e2eRunLockFile(), JSON.stringify(lock, null, 2));
}

export function removeE2eRunLock(): void {
    try {
        unlinkSync(e2eRunLockFile());
    } catch {
        // ignore
    }
}

export function readSerializedChainState(): SerializedChainState | null {
    const stateFile = chainStateFile();
    if (!existsSync(stateFile)) return null;
    try {
        return JSON.parse(
            readFileSync(stateFile, "utf8"),
        ) as SerializedChainState;
    } catch {
        return null;
    }
}

/**
 * Verify the managed e2e chain is still running before a spec uses it.
 */
export async function assertE2eChainHealthy(
    timeoutMs = 5_000,
): Promise<void> {
    const state = readSerializedChainState();
    if (!state) {
        throw new Error(
            `e2e chain state file missing at ${chainStateFile()}; did global-setup run?`,
        );
    }
    const port = state.port;
    const apiHost = DEFAULT_API_HOST;
    if (!state.external) {
        if (!isProcessAlive(state.psinodePid)) {
            const logHint = state.psinodeLog
                ? ` See ${state.psinodeLog}.`
                : "";
            throw new Error(
                `e2e psinode exited (pid ${state.psinodePid}).${logHint}`,
            );
        }
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const probe = await probeAdminStatus(apiHost, port);
        if (probe.ok && probe.ready) {
            return;
        }
        await delay(250);
    }
    throw new Error(
        `e2e chain is not reachable on 127.0.0.1:${port} (admin probe failed).`,
    );
}

export type SerializedChainState =
    | { external: true; host: string; port: number; baseUrl?: string }
    | {
          external: false;
          host: string;
          port: number;
          baseUrl: string;
          dbDir: string;
          psinodePid: number;
          psinodeLog?: string;
      };

function killPsinodeTree(pid: number, signal: NodeJS.Signals): void {
    try {
        process.kill(-pid, signal);
        return;
    } catch {
        // Not a process-group leader; fall back to the pid itself.
    }
    try {
        process.kill(pid, signal);
    } catch {
        // already exited
    }
}

async function waitForPsinodeExit(
    pid: number,
    timeoutMs: number,
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            process.kill(pid, 0);
        } catch {
            return;
        }
        await delay(100);
    }
}

/**
 * Stop a psinode chain previously serialized to the e2e state file.
 * Safe to call when the process is already gone.
 */
export async function stopManagedChain(
    state: Extract<SerializedChainState, { external: false }>,
): Promise<void> {
    killPsinodeTree(state.psinodePid, "SIGTERM");
    await waitForPsinodeExit(state.psinodePid, 5_000);
    killPsinodeTree(state.psinodePid, "SIGKILL");
    await waitForPsinodeExit(state.psinodePid, 1_000);
    rmSync(state.dbDir, { recursive: true, force: true });
}

/**
 * If a prior Playwright run crashed before globalTeardown, kill the leftover
 * chain and remove the stale state file so the next run can boot cleanly.
 */
export async function cleanupStaleChainFromDisk(options?: {
    respectRunLock?: boolean;
}): Promise<void> {
    if (options?.respectRunLock !== false) {
        const lock = readRunLock();
        if (lock && isProcessAlive(lock.ownerPid)) {
            return;
        }
    }
    removeE2eRunLock();

    const stateFile = chainStateFile();
    if (!existsSync(stateFile)) return;

    let state: SerializedChainState;
    try {
        state = JSON.parse(
            readFileSync(stateFile, "utf8"),
        ) as SerializedChainState;
    } catch {
        unlinkSync(stateFile);
        return;
    }

    try {
        if (!state.external) {
            await stopManagedChain(state);
        }
    } finally {
        try {
            unlinkSync(stateFile);
        } catch {
            // ignore
        }
    }
}

/**
 * Tear down the managed e2e chain and ensure nothing is still listening on the
 * boot port so the next run can start cleanly.
 */
export async function forceReleaseE2eChainPort(
    port = Number(process.env.PSIBASE_E2E_PORT ?? "8080"),
    options?: { ignoreRunLock?: boolean },
): Promise<void> {
    if (!options?.ignoreRunLock) {
        assertNoConcurrentE2eRun();
    }
    await cleanupStaleChainFromDisk({
        respectRunLock: !options?.ignoreRunLock,
    });

    const host = "127.0.0.1";
    if (!(await isPortBound(host, port))) {
        return;
    }

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const killPid = (pid: number): void => {
        if (!Number.isFinite(pid) || pid <= 1) return;
        killPsinodeTree(pid, "SIGTERM");
    };

    try {
        const { stdout } = await execFileAsync("fuser", [`${port}/tcp`], {
            encoding: "utf8",
        });
        for (const token of stdout.split(/\s+/)) {
            const pid = Number(token);
            if (Number.isFinite(pid)) killPid(pid);
        }
    } catch {
        try {
            const { stdout } = await execFileAsync("lsof", [
                `-ti:${port}`,
            ], { encoding: "utf8" });
            for (const line of stdout.trim().split("\n")) {
                const pid = Number(line.trim());
                if (Number.isFinite(pid)) killPid(pid);
            }
        } catch {
            // nothing listening or tools unavailable
        }
    }

    for (let i = 0; i < 50; i += 1) {
        if (!(await isPortBound(host, port, 200))) {
            return;
        }
        await delay(200);
    }

    try {
        const { stdout } = await execFileAsync("lsof", [`-ti:${port}`], {
            encoding: "utf8",
        });
        for (const line of stdout.trim().split("\n")) {
            const pid = Number(line.trim());
            if (Number.isFinite(pid)) {
                killPsinodeTree(pid, "SIGKILL");
            }
        }
    } catch {
        // ignore
    }

    if (await isPortBound(host, port, 500)) {
        throw new Error(
            `e2e chain port ${host}:${port} is still in use after teardown`,
        );
    }
}

let workerCleanupRegistered = false;

/**
 * Register SIGINT/SIGTERM handlers in the Playwright worker so an interrupted
 * test run still tears down the booted chain (globalTeardown is a separate process
 * and may not run when the runner is killed).
 */
export function registerE2eChainCleanupHandlers(): void {
    if (workerCleanupRegistered) return;
    workerCleanupRegistered = true;

    const cleanupSync = (): void => {
        const stateFile = chainStateFile();
        if (!existsSync(stateFile)) return;
        let state: SerializedChainState;
        try {
            state = JSON.parse(
                readFileSync(stateFile, "utf8"),
            ) as SerializedChainState;
        } catch {
            try {
                unlinkSync(stateFile);
            } catch {
                // ignore
            }
            return;
        }
        if (state.external) return;
        killPsinodeTree(state.psinodePid, "SIGKILL");
        rmSync(state.dbDir, { recursive: true, force: true });
        try {
            unlinkSync(stateFile);
        } catch {
            // ignore
        }
    };

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => {
            cleanupSync();
            process.exit(signal === "SIGINT" ? 130 : 143);
        });
    }
    // Do not register `exit`: Playwright may recycle workers between tests;
    // tearing down here removes the chain state file while later specs still run.
}

const log = (debug: boolean | undefined, ...args: unknown[]): void => {
    if (debug) {
        console.error("[chain-boot]", ...args);
    }
};

/**
 * Resolve psinode/psibase binaries with the same precedence as the ai-tools
 * `launch_chain` MCP tool. Throws when neither binary can be located.
 */
function resolveBinaries(
    opts: ChainBootOptions,
): { psinode: string; psibase: string } {
    const psinode =
        opts.psinodePath ??
        process.env.PSIBASE_PSINODE ??
        process.env.AI_DEV_PSINODE_PATH ??
        join(REPO_ROOT, "build", "psinode");
    const psibase =
        opts.psibasePath ??
        process.env.PSIBASE_PSIBASE ??
        process.env.AI_DEV_PSIBASE_PATH ??
        join(REPO_ROOT, "build", "rust", "release", "psibase");
    return { psinode, psibase };
}

/**
 * True when *anything* accepts a TCP connection on `host:port`. Used as the
 * "is something already there?" guard before spawning psinode.
 */
export async function isPortBound(
    host: string,
    port: number,
    timeoutMs = 1000,
): Promise<boolean> {
    return await new Promise<boolean>((resolveProbe) => {
        const sock = tcpConnect({ host, port });
        const finish = (ok: boolean) => {
            sock.destroy();
            resolveProbe(ok);
        };
        const timer = globalThis.setTimeout(() => finish(false), timeoutMs);
        sock.once("connect", () => {
            globalThis.clearTimeout(timer);
            finish(true);
        });
        sock.once("error", () => {
            globalThis.clearTimeout(timer);
            finish(false);
        });
    });
}

function adminHostHeader(host: string, port: number): string {
    const cleaned = host.startsWith("x-admin.") ? host : "x-admin." + host;
    return `${cleaned}:${port}`;
}

/**
 * Probe `GET /native/admin/status` exactly like the ai-tools `launch_chain`
 * helper: connect to `127.0.0.1:port` but spoof `Host: x-admin.<host>:port`
 * so XHttp dispatches to the native admin handler instead of bouncing 302.
 *
 * Returns:
 *   { ok: true, ready: true }  - psinode finished startup
 *   { ok: true, ready: false } - psinode replied but is still in `["startup"]`
 *   { ok: false }              - connect/IO error (caller should retry)
 */
async function probeAdminStatus(
    host: string,
    port: number,
    timeoutMs = 1500,
): Promise<{ ok: true; ready: boolean } | { ok: false }> {
    return await new Promise((resolveProbe) => {
        const req = httpRequest(
            {
                method: "GET",
                host: "127.0.0.1",
                port,
                path: "/native/admin/status",
                headers: {
                    // psinode dispatches by Host subdomain. /native/* on the
                    // bare root host returns 302; only x-admin.<root> hits
                    // the native admin handler. (Mirrors ai-tools
                    // chain_common.admin_status_probe_request.)
                    Host: adminHostHeader(host, port),
                },
                timeout: timeoutMs,
            },
            (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    body += chunk;
                });
                res.on("end", () => {
                    if (res.statusCode !== 200) {
                        resolveProbe({ ok: false });
                        return;
                    }
                    try {
                        const data = JSON.parse(body) as unknown;
                        const stillStarting =
                            Array.isArray(data) &&
                            (data as unknown[]).some(
                                (v) => v === "startup",
                            );
                        resolveProbe({ ok: true, ready: !stillStarting });
                    } catch {
                        resolveProbe({ ok: false });
                    }
                });
            },
        );
        req.on("error", () => resolveProbe({ ok: false }));
        req.on("timeout", () => {
            req.destroy();
            resolveProbe({ ok: false });
        });
        req.end();
    });
}

/**
 * Wait for psinode to finish startup. Polls /native/admin/status (with the
 * x-admin Host header) until status 200 and the body no longer contains
 * "startup".
 */
/**
 * The Packages GraphQL endpoint is briefly unavailable right after boot.
 * `psibase install` needs it to list installed packages.
 */
async function waitForPackagesReady(
    host: string,
    port: number,
    deadlineMs: number,
    debug?: boolean,
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < deadlineMs) {
        const ok = await new Promise<boolean>((resolveProbe) => {
            const req = httpRequest(
                {
                    method: "POST",
                    host: "127.0.0.1",
                    port,
                    path: "/graphql",
                    headers: {
                        Host: `packages.${host}:${port}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 1500,
                },
                (res) => {
                    res.resume();
                    resolveProbe(res.statusCode === 200);
                },
            );
            req.on("error", () => resolveProbe(false));
            req.on("timeout", () => {
                req.destroy();
                resolveProbe(false);
            });
            req.end(JSON.stringify({ query: "{ __typename }" }));
        });
        if (ok) {
            log(debug, "packages registry ready");
            return;
        }
        await delay(250);
    }
    throw new Error(
        `packages registry did not become ready on http://packages.${host}:${port}/graphql within ${deadlineMs}ms`,
    );
}

async function waitForPsinodeReady(
    host: string,
    port: number,
    deadlineMs: number,
    debug?: boolean,
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < deadlineMs) {
        const probe = await probeAdminStatus(host, port);
        if (probe.ok && probe.ready) {
            log(debug, "psinode ready");
            return;
        }
        await delay(250);
    }
    throw new Error(
        `psinode did not finish startup on http://${host}:${port}/ within ${deadlineMs}ms`,
    );
}

async function runOnce(
    cmd: string,
    args: string[],
    options: { cwd?: string; debug?: boolean; timeoutMs?: number } = {},
): Promise<void> {
    return await new Promise<void>((res, rej) => {
        const child = spawn(cmd, args, {
            cwd: options.cwd ?? REPO_ROOT,
            stdio: options.debug ? "inherit" : "pipe",
        });
        let stderr = "";
        if (!options.debug && child.stderr) {
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (chunk: string) => {
                stderr += chunk;
            });
        }
        const timer = options.timeoutMs
            ? globalThis.setTimeout(() => {
                  child.kill("SIGKILL");
                  rej(
                      new Error(
                          `command timed out after ${options.timeoutMs}ms: ${cmd} ${args.join(" ")}`,
                      ),
                  );
              }, options.timeoutMs)
            : undefined;
        child.on("error", (err) => {
            if (timer) globalThis.clearTimeout(timer);
            rej(err);
        });
        child.on("exit", (code) => {
            if (timer) globalThis.clearTimeout(timer);
            if (code === 0) {
                res();
            } else {
                rej(
                    new Error(
                        `command failed (${code}): ${cmd} ${args.join(" ")}${stderr ? `\n${stderr.trim()}` : ""}`,
                    ),
                );
            }
        });
    });
}

async function runWithRetry(
    cmd: string,
    args: string[],
    options: { cwd?: string; debug?: boolean; timeoutMs?: number; attempts?: number } = {},
): Promise<void> {
    const attempts = options.attempts ?? 3;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            await runOnce(cmd, args, options);
            return;
        } catch (e) {
            lastError = e;
            if (i + 1 < attempts) {
                await delay(1_000 * (i + 1));
            }
        }
    }
    throw lastError;
}

/**
 * Boot a fresh chain in a new db directory.
 * Throws with a human-readable message when a chain is already listening.
 */
export async function bootFreshChain(
    opts: ChainBootOptions = {},
): Promise<ChainHandle> {
    const apiHost = opts.apiHost ?? opts.host ?? DEFAULT_API_HOST;
    const browserHost =
        opts.browserHost ?? opts.host ?? DEFAULT_BROWSER_HOST;
    const port =
        opts.port ??
        (process.env.PSIBASE_E2E_PORT
            ? Number(process.env.PSIBASE_E2E_PORT)
            : DEFAULT_PORT);
    const debug = opts.debug ?? !!process.env.PSIBASE_E2E_DEBUG;

    if (await isPortBound("127.0.0.1", port)) {
        throw new Error(
            `A process is already listening on 127.0.0.1:${port}.\n\n` +
                "Refusing to start an e2e chain on top of an existing one.\n" +
                "Stop the running chain first:\n" +
                "  • via ai-tools MCP: call cancel_chain with its job_id, or\n" +
                "  • manually: run `lsof -i :" +
                port +
                "` to find the pid and `kill <pid>`.\n",
        );
    }

    const { psinode, psibase } = resolveBinaries(opts);
    const dbDir = mkdtempSync(join(tmpdir(), "psibase-e2e-db-"));
    log(debug, "fresh db dir", { dbDir });

    const psinodeLog =
        process.env.PSIBASE_E2E_PSINODE_LOG ??
        join(tmpdir(), `psinode-e2e-${Date.now()}.log`);
    log(debug, "psinode log path", { psinodeLog });
    const psinodeLogFd = openSync(psinodeLog, "w");

    const child: ChildProcess = spawn(
        psinode,
        [dbDir, "-p", "myprod", "-l", `127.0.0.1:${port}`],
        {
            cwd: REPO_ROOT,
            detached: true,
            stdio: debug
                ? "inherit"
                : ["ignore", psinodeLogFd, psinodeLogFd],
            env: {
                ...process.env,
                PSIBASE_ADMIN_IP: "127.0.0.1",
            },
        },
    );

    if (!child.pid) {
        rmSync(dbDir, { recursive: true, force: true });
        throw new Error(`failed to spawn psinode at ${psinode}`);
    }

    child.unref();

    const stop = async (): Promise<void> => {
        if (child.pid) {
            killPsinodeTree(child.pid, "SIGTERM");
            await waitForPsinodeExit(child.pid, 5_000);
            killPsinodeTree(child.pid, "SIGKILL");
        }
        rmSync(dbDir, { recursive: true, force: true });
    };

    try {
        const deadline = opts.bootTimeoutMs ?? 30_000;
        await waitForPsinodeReady(apiHost, port, deadline, debug);
        log(debug, "running psibase boot", { packages: BOOT_PACKAGES });
        await runOnce(
            psibase,
            [
                "boot",
                "-p",
                "myprod",
                "-a",
                `http://${apiHost}:${port}/`,
                ...BOOT_PACKAGES,
            ],
            { debug, timeoutMs: 240_000 },
        );

        await waitForPackagesReady(apiHost, port, 60_000, debug);
        await delay(1_000);

        if (SKIP_REINSTALL) {
            log(debug, "PSIBASE_E2E_SKIP_REINSTALL=1: stopping after boot");
            return {
                host: browserHost,
                apiHost,
                port,
                baseUrl: `http://${browserHost}:${port}/`,
                dbDir,
                psinodePid: child.pid,
                stop,
            };
        }

        const packageSource =
            process.env.PSIBASE_E2E_PACKAGE_SOURCE ??
            join(REPO_ROOT, "build", "share", "psibase", "packages");
        const reinstall = [
            ...REINSTALL_PACKAGES,
            ...(opts.extraInstallPackages ?? []),
        ];
        for (const pkg of reinstall) {
            log(debug, "reinstalling package", pkg, { packageSource });
            await runWithRetry(
                psibase,
                [
                    "install",
                    "--reinstall",
                    "-a",
                    `http://${apiHost}:${port}/`,
                    "--package-source",
                    packageSource,
                    "-y",
                    pkg,
                ],
                { debug, timeoutMs: 180_000 },
            );
        }
        for (const pkg of LOCAL_PACKAGES) {
            log(debug, "reinstalling local package", pkg, { packageSource });
            await runWithRetry(
                psibase,
                [
                    "install",
                    "--local",
                    "--reinstall",
                    "-a",
                    `http://${apiHost}:${port}/`,
                    "--package-source",
                    packageSource,
                    pkg,
                ],
                { debug, timeoutMs: 180_000 },
            );
        }
    } catch (e) {
        await stop();
        throw e;
    }

    return {
        host: browserHost,
        apiHost,
        port,
        baseUrl: `http://${browserHost}:${port}/`,
        dbDir,
        psinodePid: child.pid,
        psinodeLog,
        stop,
    };
}
