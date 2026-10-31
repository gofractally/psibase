// mcp needs-approval UI. Everything goes through the `mcp` plugin in the
// Supervisor: it reads the query-token-gated `needsApproval` list for the
// logged-in user and submits Approve / Approve and Grant as one transaction
// signed by the Supervisor's key vault.
import { renderRows } from "./logic.js";
import { connectSupervisor } from "./supervisor.js";

const $ = (id) => document.getElementById(id);
const supervisor = connectSupervisor();
const plugin = (method, params = []) => supervisor.call("mcp", "approvals", method, params);

async function login() {
    // Current branch: host:accounts; v0.29.0-pre: accounts:plugin.
    const root = location.host.split(".").slice(1).join(".");
    const head = (await fetch(`${location.protocol}//host.${root}/accounts.wasm`, { method: "HEAD" }).catch(() => null))?.ok;
    if (head) await supervisor.call("host", "active-app", "connect-account", [], "accounts");
    else await supervisor.call("accounts", "active-app", "connect-account", []);
}

export async function refresh() {
    $("status").textContent = "Loading…";
    let rows;
    try {
        const res = await plugin("needs-approval");
        if (typeof res !== "string" || !res.startsWith("[")) throw new Error(String(res));
        rows = JSON.parse(res);
    } catch (e) {
        $("status").textContent = `Log in to view your approvals. (${e.message})`;
        $("list").innerHTML = `<button data-testid="login">Log in</button>`;
        document.querySelector("[data-testid=login]").onclick = login;
        return;
    }
    // Rows are removed on chain by Approve (untrack) and Approve and Grant
    // (grant_missing); a row whose staged tx was handled elsewhere shows an
    // error on click. (Cross-origin staged-tx reads from the page are blocked
    // by CORS preflight, so liveness filtering with visibleRows() is left to
    // the plugin in a follow-up.)
    $("status").textContent = "";
    $("list").innerHTML = renderRows(rows);
    for (const el of document.querySelectorAll("[data-testid=pending-row]")) {
        const row = rows.find((r) => String(r.pending.id) === el.dataset.id);
        const run = (method) => async () => {
            el.querySelectorAll("button").forEach((b) => (b.disabled = true));
            let err = "";
            try {
                await plugin(method, [row.pending.account, row.pending.id]);
            } catch (e) {
                err = e.message;
            }
            await refresh();
            if (err) $("status").textContent = err;
        };
        el.querySelector("[data-act=approve]").onclick = run("approve");
        el.querySelector("[data-act=grant]").onclick = run("approve-and-grant");
    }
}

window.mcpRefresh = refresh;
refresh();
