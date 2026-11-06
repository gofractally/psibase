import type { Devnet } from "../../../../e2e/fixtures/devnet";

import { writeFileSync } from "node:fs";

import {
    type KeyAccount,
    createKeyAccount,
    pushActions,
} from "../../../../e2e/fixtures";
import { raw } from "../../../local/XMcp/e2e/client";

/** POST a GraphQL query to <sub>/graphql (optionally with a query token). */
export async function gql(
    devnet: Devnet,
    sub: string,
    query: string,
    token?: string,
): Promise<any> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await raw(
        devnet,
        sub,
        "POST",
        "/graphql",
        JSON.stringify({ query }),
        headers,
    );
    return JSON.parse(r.text);
}

/** Two-account model: the owner keeps its key and is the sender; the agent proposes. */
export interface AgentSetup {
    owner: KeyAccount;
    agent: KeyAccount;
}

/**
 * Owner-signed setup (V2 doc, same txs as the mcp UI): register the agent on
 * the owner's own account, then make `mcp` the owner's auth service. The
 * owner's auth-sig key is unchanged. No managed account is created.
 */
export async function setupAgent(
    devnet: Devnet,
    dir: string,
): Promise<AgentSetup> {
    const owner = await createKeyAccount(devnet, dir);
    const agent = await createKeyAccount(devnet, dir);
    await pushActions(
        devnet,
        dir,
        [
            {
                sender: owner.name,
                service: "mcp",
                method: "bootstrap",
                data: { agent: agent.name },
            },
            {
                sender: owner.name,
                service: "accounts",
                method: "setAuthServ",
                data: { authService: "mcp" },
            },
        ],
        { keys: [owner.privateKeyPath] },
    );
    return { owner, agent };
}

/** `setupAgent` plus the agent's tokens auto-debit, as the UI setup does. */
export async function bootstrapAgent(
    devnet: Devnet,
    dir: string,
): Promise<AgentSetup> {
    const s = await setupAgent(devnet, dir);
    // Matches enable-agent-auto-debit in the plugin (agent signs for itself).
    await pushActions(
        devnet,
        dir,
        [
            {
                sender: s.agent.name,
                service: "tokens",
                method: "setUserConf",
                data: { index: 0, enabled: true },
            },
        ],
        { keys: [s.agent.privateKeyPath] },
    );
    return s;
}

export async function profileOf(
    devnet: Devnet,
    account: string,
): Promise<string | undefined> {
    const j = await gql(
        devnet,
        "profiles",
        `{ profile(account: "${account}") { displayName } }`,
    );
    return j?.data?.profile?.displayName ?? undefined;
}

/** The agent stages `profiles.setProfile` with the owner as sender; returns the staged-tx id if it is still pending. */
export async function agentSetsProfile(
    devnet: Devnet,
    dir: string,
    s: AgentSetup,
    displayName: string,
) {
    const out = await pushActions(
        devnet,
        dir,
        [
            {
                sender: s.owner.name,
                service: "profiles",
                method: "setProfile",
                data: { display_name: displayName, bio: "" },
            },
        ],
        { keys: [s.agent.privateKeyPath], proposer: s.agent.name },
    );
    return out;
}

export async function pendingIdsFor(
    devnet: Devnet,
    proposer: string,
): Promise<number[]> {
    return (await stagedByProposer(devnet, proposer)).map((n) => n.id);
}

export async function stagedByProposer(
    devnet: Devnet,
    proposer: string,
): Promise<{ id: number; txid: string }[]> {
    const j = await gql(
        devnet,
        "staged-tx",
        `{ getStagedByProposer(proposer: "${proposer}") { edges { node { id txid } } } }`,
    );
    return (j?.data?.getStagedByProposer?.edges ?? []).map((e: any) => ({
        id: e.node.id,
        txid: e.node.txid,
    }));
}

/**
 * Create a token as `issuer`, mint it, and credit `debitor`. Debitor needs
 * AUTO_DEBIT. No debitor key required.
 */
export async function issueAndCredit(
    devnet: Devnet,
    dir: string,
    issuer: KeyAccount,
    debitor: string,
    amount = "1000000",
): Promise<number> {
    // Token create credits the issuer NFT; without NFT auto-debit the issuer
    // never becomes the holder and mint fails with "Missing required authority".
    await pushActions(
        devnet,
        dir,
        [
            {
                sender: issuer.name,
                service: "nft",
                method: "setUserConf",
                data: { index: 0, enable: true },
            },
        ],
        { keys: [issuer.privateKeyPath] },
    );
    const createFile = `${dir}/create-token.json`;
    writeFileSync(
        createFile,
        JSON.stringify([
            {
                sender: issuer.name,
                service: "tokens",
                method: "create",
                data: {
                    precision: 4,
                    max_issued_supply: { value: "100000000" },
                },
            },
        ]),
    );
    const created = await devnet.psibase([
        "push",
        createFile,
        "-s",
        issuer.privateKeyPath,
        "--trace",
        "json",
    ]);
    const blob = created.stdout + "\n" + created.stderr;
    const tid = tidFromCreateTrace(blob);
    if (!Number.isFinite(tid)) {
        throw new Error(
            `issueAndCredit: could not parse create retval: ${blob.slice(0, 1500)}`,
        );
    }
    // Confirm the token exists before minting (also surfaces a wrong parse).
    const check = await gql(
        devnet,
        "tokens",
        `{ token(tokenId: "${tid}") { id } }`,
    );
    if (!check?.data?.token) {
        throw new Error(
            `issueAndCredit: parsed tid=${tid} but token missing; trace=${blob.slice(0, 1500)}`,
        );
    }
    await pushActions(
        devnet,
        dir,
        [
            {
                sender: issuer.name,
                service: "tokens",
                method: "mint",
                data: {
                    token_id: tid,
                    amount: { value: amount },
                    memo: "e2e mint",
                },
            },
            {
                sender: issuer.name,
                service: "tokens",
                method: "credit",
                data: {
                    token_id: tid,
                    debitor,
                    amount: { value: amount },
                    memo: "e2e fund owner",
                },
            },
        ],
        { keys: [issuer.privateKeyPath] },
    );
    return tid;
}

/** Pull the TID from `psibase push --trace json` of tokens.create. */
function tidFromCreateTrace(out: string): number {
    try {
        const j = JSON.parse(out);
        const stack: any[] = [
            ...(j?.actionTraces ?? []),
            ...(j?.transactionTrace?.actionTraces ?? []),
        ];
        while (stack.length) {
            const a = stack.pop();
            if (!a) continue;
            if (
                a.action?.service === "tokens" &&
                a.action?.method === "create"
            ) {
                const v = a.retval;
                if (typeof v === "number") return v;
                if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
            }
            for (const i of a.innerTraces ?? []) {
                if (i?.inner?.ActionTrace) stack.push(i.inner.ActionTrace);
                else if (i?.actionTrace) stack.push(i.actionTrace);
            }
        }
    } catch {
        /* fall through */
    }
    return NaN;
}
