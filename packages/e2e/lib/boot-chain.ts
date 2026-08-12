import { spawn } from "node:child_process";
import { resolveBin } from "./psinode-bin";
import { waitForChain } from "./node-ready";

const BOOT_API_URL = "http://psibase.localhost/";
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

    await waitForChain(options.socketPath, BOOT_TIMEOUT_MS);
}
