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
};

export type AgentCfg = {
    account: string;
    agent: string;
    parent: string;
};

/** Actions for "Approve": the parent accepts the staged tx, then drops the tracked row. */
export function approveActions(parent: string, row: PendingRow) {
    return [
        {
            sender: parent,
            service: "staged-tx",
            method: "accept",
            data: { id: row.pending.id, txid: row.pending.txid },
        },
        {
            sender: parent,
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
export function approveAndGrantActions(parent: string, row: PendingRow) {
    return [
        {
            sender: parent,
            service: "mcp",
            method: "grant_missing",
            data: { account: row.pending.account, id: row.pending.id },
        },
        {
            sender: parent,
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

const PEM_PLACEHOLDER = "<PASTE agent private key HERE>";

/**
 * Setup hand-off: identity and how to reach the chain. No task — that comes
 * in a later message. Managed account is named until a by-agent lookup exists.
 */
export function agentHandOffPrompt(
    cfg: Pick<AgentCfg, "account" | "agent">,
    opts: { pem?: string } = {},
) {
    const key = opts.pem?.trim() || PEM_PLACEHOLDER;
    return `You can execute transactions on the Psibase blockchain (node at http://psibase.localhost:8080/) on behalf of the user.
You are the agent account ${cfg.agent}. You act on behalf of the user via their managed account ${cfg.account}.

Private key for ${cfg.agent}:
${key}

Use this Model Context Protocol (MCP) endpoint for on-chain service discovery and unsigned transaction building. It never signs or pushes; follow its instructions for how to submit:
http://x-mcp.psibase.localhost:8080/`;
}
