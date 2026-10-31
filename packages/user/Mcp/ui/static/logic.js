// Pure logic for the mcp needs-approval UI (unit-tested with vitest).

// approveActions / approveAndGrantActions document (and unit-test) what the
// mcp plugin's `approve` / `approve-and-grant` put in the transaction.

/** Actions for "Approve": the parent accepts the staged tx, then drops the tracked row. */
export function approveActions(parent, row) {
    return [
        { sender: parent, service: "staged-tx", method: "accept", data: { id: row.pending.id, txid: row.pending.txid } },
        { sender: parent, service: "mcp", method: "untrack", data: { account: row.pending.account, id: row.pending.id } },
    ];
}

/**
 * Actions for "Approve and Grant", in one transaction: grant every missing
 * service/method pair (mcp::grant_missing, which also drops the tracked row),
 * then accept.
 */
export function approveAndGrantActions(parent, row) {
    return [
        { sender: parent, service: "mcp", method: "grant_missing", data: { account: row.pending.account, id: row.pending.id } },
        { sender: parent, service: "staged-tx", method: "accept", data: { id: row.pending.id, txid: row.pending.txid } },
    ];
}

/** Rows to show: drop rows whose staged tx no longer exists on staged-tx. */
export function visibleRows(rows, liveIds) {
    const live = new Set(liveIds);
    return rows.filter((r) => live.has(r.pending.id));
}

/** One-line summary of a pending tx's actions. */
export function summarize(row) {
    return row.pending.actions.map((a) => `${a.sender} → ${a.service}.${a.method}`).join(", ");
}

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function renderRows(rows) {
    if (rows.length === 0) return `<p data-testid="empty">Nothing needs approval.</p>`;
    return rows
        .map(
            (r) => `<div class="row" data-testid="pending-row" data-id="${r.pending.id}">
  <div><b>#${r.pending.id}</b> for <code>${escapeHtml(r.pending.account)}</code> (proposed by ${escapeHtml(r.pending.proposer)})</div>
  <div class="actions">${escapeHtml(summarize(r))}</div>
  <div class="missing">Not yet granted: ${r.missing.map(escapeHtml).join(", ") || "none"}</div>
  <button data-act="approve">Approve</button>
  <button data-act="grant">Approve and Grant</button>
</div>`,
        )
        .join("\n");
}
