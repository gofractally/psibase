import { generateKeyPairSync, randomInt } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Devnet } from "./devnet";

export interface KeyAccount {
    name: string;
    publicKeyPem: string;
    /** PKCS#8 PEM; also on disk at privateKeyPath for the psibase CLI. */
    privateKeyPem: string;
    privateKeyPath: string;
}

export interface PrettyAction {
    sender: string;
    service: string;
    method: string;
    data: unknown;
}

/** A key-pair directory that callers must remove with cleanup(). */
export function keyDir() {
    const dir = mkdtempSync(join(tmpdir(), "psibase-e2e-key-"));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function randomName(prefix = "e") {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    return prefix + Array.from({ length: 10 - prefix.length }, () => letters[randomInt(26)]).join("");
}

/** Fresh P-256 key + an account on the chain secured by it (auth-sig). */
export async function createKeyAccount(devnet: Devnet, dir: string, name = randomName()): Promise<KeyAccount> {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const pubPath = join(dir, `${name}.pub.pem`);
    const privateKeyPath = join(dir, `${name}.pem`);
    writeFileSync(pubPath, publicKeyPem);
    writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
    await devnet.psibase(["create", name, "-k", pubPath]);
    return { name, publicKeyPem, privateKeyPem, privateKeyPath };
}

/** Push one transaction of pretty (JSON-data) actions with the psibase CLI. */
export async function pushActions(
    devnet: Devnet,
    dir: string,
    actions: PrettyAction[],
    opts: { keys?: string[]; proposer?: string } = {},
) {
    const file = join(dir, `tx-${Date.now()}-${randomInt(1e9)}.json`);
    writeFileSync(file, JSON.stringify(actions));
    const args = ["push", file];
    for (const k of opts.keys ?? []) args.push("-s", k);
    if (opts.proposer) args.push("--proposer", opts.proposer);
    return devnet.psibase(args);
}

/**
 * Fund an account from the chain's system token, if one is configured.
 * On a DevDefault chain transactions are free, so this is a no-op unless a
 * system token exists; it credits from `root` (auth-any on dev chains).
 */
export async function fund(devnet: Devnet, dir: string, account: string, amount = "100") {
    const r = await devnet.get("tokens", `/graphql?query={config{sysTid}}`);
    let tid: number | undefined;
    try {
        tid = JSON.parse(r.body)?.data?.config?.sysTid ?? undefined;
    } catch {
        tid = undefined;
    }
    if (tid === undefined || tid === null) return false;
    await pushActions(devnet, dir, [
        { sender: "root", service: "tokens", method: "credit", data: { token_id: tid, debitor: account, amount: { value: amount }, memo: "e2e funding" } },
    ]);
    return true;
}
