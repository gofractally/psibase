/** Pure helpers for the mcp needs-approval UI (unit-tested with vitest). */

export type PendingAction = {
    sender: string;
    service: string;
    method: string;
};

export type PendingRow = {
    pending: {
        id: number;
        txid: string;
        account: string;
        proposer: string;
        actions: PendingAction[];
    };
    missing: string[];
    inspection?: string;
    canEnforce?: boolean;
};

/** `account` is the owner (the sender on the agent's staged txs). */
export type AgentCfg = {
    account: string;
    agent: string;
    enforcer?: string | null;
};

/** Actions for "Approve": the owner accepts the staged tx, then drops the tracked row. */
export function approveActions(owner: string, row: PendingRow) {
    return [
        {
            sender: owner,
            service: "staged-tx",
            method: "accept",
            data: { id: row.pending.id, txid: row.pending.txid },
        },
        {
            sender: owner,
            service: "mcp",
            method: "untrack",
            data: { account: row.pending.account, id: row.pending.id },
        },
    ];
}

/**
 * Actions for "Approve and Grant", in one transaction: grant every missing
 * service/method pair (mcp::grant_missing, which also drops the tracked row),
 * then accept.
 */
export function approveAndGrantActions(owner: string, row: PendingRow) {
    return [
        {
            sender: owner,
            service: "mcp",
            method: "grant_missing",
            data: { account: row.pending.account, id: row.pending.id },
        },
        {
            sender: owner,
            service: "staged-tx",
            method: "accept",
            data: { id: row.pending.id, txid: row.pending.txid },
        },
    ];
}

/** Rows to show: drop rows whose staged tx no longer exists on staged-tx. */
export function visibleRows(rows: PendingRow[], liveIds: number[]) {
    const live = new Set(liveIds);
    return rows.filter((r) => live.has(r.pending.id));
}

/** One-line summary of a pending tx's actions. */
export function summarize(row: PendingRow) {
    return row.pending.actions
        .map((a) => `${a.sender} → ${a.service}.${a.method}`)
        .join(", ");
}

/**
 * Node root URL from the mcp page's origin: `http://mcp.psibase.localhost:8080`
 * -> `http://psibase.localhost:8080/` (same derivation as the agent page).
 */
export function chainUrls(origin: { protocol: string; host: string }) {
    const root = origin.host.replace(/^mcp\./, "");
    return {
        node: `${origin.protocol}//${root}/`,
        xMcp: `${origin.protocol}//x-mcp.${root}/`,
    };
}

const PEM_PLACEHOLDER = "<PASTE agent private key HERE>";

/**
 * Setup hand-off: identity and how to reach the chain. No task — that comes
 * in a later message. The owner account is the sender on proposals.
 */
export function agentHandOffPrompt(
    cfg: Pick<AgentCfg, "account" | "agent">,
    origin: { protocol: string; host: string },
    opts: { pem?: string } = {},
) {
    const { node, xMcp } = chainUrls(origin);
    const key = opts.pem?.trim() || PEM_PLACEHOLDER;
    return `You can execute transactions on the Psibase blockchain (node at ${node}) on behalf of the user.
You are the agent account ${cfg.agent}. You act on behalf of the user's own account ${cfg.account}: propose staged transactions with ${cfg.account} as the sender. Allowlisted actions execute after the owner-held enforcer also accepts when configured; anything else waits for the user to approve. Never request or use the enforcer key.

Private key for ${cfg.agent}:
${key}

Use this Model Context Protocol (MCP) endpoint for on-chain service discovery and unsigned transaction building. It never signs or pushes; follow its instructions for how to submit:
${xMcp}`;
}
