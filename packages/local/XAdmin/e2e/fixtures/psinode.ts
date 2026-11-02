import { expect, test as base, type TestInfo } from "@playwright/test";
import bcrypt from "bcryptjs";
import {
    execFile,
    spawn,
    type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolvePsinodeBin } from "../lib/psinode-bin";
import { socketRequest } from "../lib/socket-request";

const execFileAsync = promisify(execFile);

const ADMIN_HOST = "x-admin.psibase.localhost";
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_MS = 100;
const SOFTHSM_PIN = process.env.E2E_SOFTHSM_PIN ?? "Ch4ng#Me!";

export type StartPsinodeOptions = {
    nodeIndex: number;
    producer?: string;
    softhsm?: boolean;
};

export type PsinodeNode = {
    dir: string;
    port: number;
    socketPath: string;
    username: string;
    password: string;
    child: ChildProcessWithoutNullStreams;
    socketGet: (requestPath: string) => ReturnType<typeof socketRequest>;
};

function nodePort(workerIndex: number, nodeIndex: number): number {
    return 8100 + workerIndex * 10 + nodeIndex;
}

async function writeCredentials(
    dir: string,
): Promise<{ authDir: string; path: string; username: string; password: string }> {
    const authDir = path.join(dir, "auth");
    await mkdir(authDir, { recursive: true });
    const username = "e2e-admin";
    const password = `pw-${Math.random().toString(36).slice(2)}`;
    const hash = bcrypt.hashSync(password, 5).replace(/^\$2a\$/, "$2b$");
    const credentialsPath = path.join(authDir, "passwd");
    await writeFile(credentialsPath, `${username}:${hash}\n`, "utf8");
    return { authDir, path: credentialsPath, username, password };
}

function buildConfig(authDir: string, pkcs11Module?: string): string {
    const pkcs11 =
        pkcs11Module === undefined ? "" : `pkcs11-module = ${pkcs11Module}\n`;
    return `# psinode config
mount = $PSIBASE_DATADIR/packages
mount = ${authDir}
${pkcs11}
database-cache-size = 256MiB
service-threads = 2
http-timeout = 10s

[logger.stderr]
type = console
filter = Severity >= info
format = [{TimeStamp}] [{Severity}]: {Message}
`;
}

async function resolveLibSofthsm2(): Promise<string> {
    const fromEnv = process.env.LIBSOFTHSM2 ?? process.env.E2E_LIBSOFTHSM2;
    if (fromEnv !== undefined) {
        await access(fromEnv);
        return fromEnv;
    }
    const { stdout } = await execFileAsync("sh", [
        "-c",
        "command -v softhsm2-util",
    ]);
    const util = stdout.trim();
    if (util === "") {
        throw new Error(
            "softhsm2-util not found; install SoftHSM or set LIBSOFTHSM2",
        );
    }
    const lib = path.resolve(
        path.dirname(util),
        "../lib/softhsm/libsofthsm2.so",
    );
    await access(lib);
    return lib;
}

async function initSofthsm(dir: string, pin: string): Promise<string> {
    const softhsmDir = path.join(dir, "softhsm");
    const tokens = path.join(softhsmDir, "tokens");
    const conf = path.join(softhsmDir, "softhsm.conf");
    await mkdir(tokens, { recursive: true });
    await writeFile(conf, `directories.tokendir = ${tokens}\n`, "utf8");
    await execFileAsync(
        "softhsm2-util",
        [
            "--init-token",
            "--slot",
            "0",
            "--label",
            "psibase",
            "--pin",
            pin,
            "--so-pin",
            pin,
        ],
        { env: { ...process.env, SOFTHSM2_CONF: conf } },
    );
    return conf;
}

function childExited(child: ChildProcessWithoutNullStreams): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

function startupFailureMessage(
    reason: string,
    stderr: string,
    child: ChildProcessWithoutNullStreams,
): string {
    const exit =
        child.exitCode !== null
            ? `exit code ${child.exitCode}`
            : child.signalCode !== null
              ? `signal ${child.signalCode}`
              : "unknown exit";
    const log = stderr.trim();
    return log.length > 0
        ? `${reason} (${exit})\n${log}`
        : `${reason} (${exit})`;
}

async function waitForReady(
    socketPath: string,
    child: ChildProcessWithoutNullStreams,
    stderrLog: { text: string },
): Promise<void> {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (childExited(child)) {
            throw new Error(
                startupFailureMessage(
                    "psinode exited during startup",
                    stderrLog.text,
                    child,
                ),
            );
        }
        try {
            const response = await socketRequest({
                socketPath,
                host: ADMIN_HOST,
                path: "/native/admin/status",
            });
            if (response.statusCode === 200) {
                const status = JSON.parse(response.body) as string[];
                if (!status.includes("startup")) {
                    return;
                }
            }
        } catch {
            // psinode may not be listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_MS));
    }
    throw new Error(
        startupFailureMessage(
            "Timed out waiting for psinode to become ready",
            stderrLog.text,
            child,
        ),
    );
}

async function startPsinode(
    workerIndex: number,
    options: StartPsinodeOptions,
): Promise<PsinodeNode> {
    const psinodeBin = resolvePsinodeBin();
    const dir = await mkdtemp(path.join(os.tmpdir(), "psibase-e2e-"));
    const socketPath = path.join(dir, "socket");
    const port = nodePort(workerIndex, options.nodeIndex);
    const credentials = await writeCredentials(dir);

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        PSIBASE_PASSWD_FILE: credentials.path,
    };
    let pkcs11Module: string | undefined;
    if (options.softhsm) {
        pkcs11Module = await resolveLibSofthsm2();
        env.SOFTHSM2_CONF = await initSofthsm(dir, SOFTHSM_PIN);
    }

    await writeFile(
        path.join(dir, "config"),
        buildConfig(credentials.authDir, pkcs11Module),
        "utf8",
    );

    const args = [
        dir,
        "-l",
        socketPath,
        "-l",
        String(port),
        "--host",
        "psibase.localhost",
        "--p2p",
    ];
    if (options.producer !== undefined) {
        args.push("-p", options.producer);
    }

    const child = spawn(psinodeBin, args, {
        env,
        stdio: ["ignore", "ignore", "pipe"],
    });

    const stderrLog = { text: "" };
    child.stderr.on("data", (chunk: Buffer) => {
        stderrLog.text += chunk.toString("utf8");
    });

    if (child.pid === undefined) {
        throw new Error("Failed to spawn psinode");
    }

    try {
        await waitForReady(socketPath, child, stderrLog);
    } catch (error) {
        await stopPsinode({ dir, child });
        throw new Error(
            `psinode failed to start on port ${port}: ${error instanceof Error ? error.message : error}`,
        );
    }

    return {
        dir,
        port,
        socketPath,
        username: credentials.username,
        password: credentials.password,
        child,
        socketGet: (requestPath: string) =>
            socketRequest({
                socketPath,
                host: ADMIN_HOST,
                path: requestPath,
            }),
    };
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (
            error instanceof Object &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ESRCH"
        ) {
            return false;
        }
        throw error;
    }
}

async function stopPsinode(node: Pick<PsinodeNode, "dir" | "child">): Promise<void> {
    const pid = node.child.pid;
    if (node.child.exitCode === null && node.child.signalCode === null) {
        node.child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                node.child.kill("SIGKILL");
                resolve();
            }, 10_000);
            node.child.once("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
    await rm(node.dir, { recursive: true, force: true });

    if (pid !== undefined) {
        expect(isProcessRunning(pid)).toBe(false);
    }
    await expect(access(node.dir)).rejects.toThrow();
}

type PsinodeFixture = {
    startPsinode: (options: StartPsinodeOptions) => Promise<PsinodeNode>;
    socketRequest: typeof socketRequest;
};

export const test = base.extend<PsinodeFixture>({
    socketRequest: async ({}, use) => {
        await use(socketRequest);
    },
    startPsinode: async ({}, use, testInfo: TestInfo) => {
        const nodes: PsinodeNode[] = [];
        await use(async (options) => {
            const node = await startPsinode(testInfo.workerIndex, options);
            nodes.push(node);
            return node;
        });
        for (const node of nodes) {
            await stopPsinode(node);
        }
    },
});

export { expect } from "@playwright/test";
export { socketRequest } from "../lib/socket-request";
