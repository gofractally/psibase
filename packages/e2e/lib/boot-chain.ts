import { spawn } from "node:child_process";
import { resolveBin } from "./psinode-bin";
import { socketRequest } from "./socket-request";

const ADMIN_HOST = "x-admin.psibase.localhost";
const BOOT_API_URL = "http://psibase.localhost/";
const BOOT_POLL_MS = 250;
const BOOT_TIMEOUT_MS = 120_000;

export type BootChainOptions = {
    socketPath: string;
    producer: string;
    packages?: string[];
};

export async function bootChain(options: BootChainOptions): Promise<void> {
    const psibaseBin = resolveBin("PSIBASE_BIN", "build/rust/release/psibase");
    const packages = options.packages ?? ["ProdDefault"];

    await new Promise<void>((resolve, reject) => {
        const args = [
            "boot",
            "-p",
            options.producer,
            ...packages,
            "-a",
            BOOT_API_URL,
            "--proxy",
            `unix:${options.socketPath}`,
        ];
        const child = spawn(psibaseBin, args, {
            stdio: ["ignore", "ignore", "pipe"],
        });

        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`psibase boot failed (exit ${code}): ${stderr.trim()}`));
        });
    });

    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const response = await socketRequest({
            socketPath: options.socketPath,
            host: ADMIN_HOST,
            path: "/native/admin/status",
        });
        if (response.statusCode === 200) {
            const status = JSON.parse(response.body) as string[];
            if (!status.includes("needgenesis")) {
                return;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, BOOT_POLL_MS));
    }

    throw new Error("Timed out waiting for chain boot to complete");
}
