// mcp needs-approval UI + agent setup. Everything goes through the `mcp` plugin.
import { renderRows, renderMyAgents } from "./logic.js";
import { connectSupervisor } from "./supervisor.js";

const $ = (id) => document.getElementById(id);
const supervisor = connectSupervisor();
const plugin = (intf, method, params = []) => supervisor.call("mcp", intf, method, params);

let pendingPem = "";
let pendingAgent = "";

async function login() {
    const root = location.host.split(".").slice(1).join(".");
    const head = (await fetch(`${location.protocol}//host.${root}/accounts.wasm`, { method: "HEAD" }).catch(() => null))?.ok;
    if (head) await supervisor.call("host", "active-app", "connect-account", [], "accounts");
    else await supervisor.call("accounts", "active-app", "connect-account", []);
}

export async function refresh() {
    $("status").textContent = "Loading…";
    let rows;
    try {
        const res = await plugin("approvals", "needs-approval");
        if (typeof res !== "string" || !res.startsWith("[")) throw new Error(String(res));
        rows = JSON.parse(res);
    } catch (e) {
        $("status").textContent = `Log in to view your approvals. (${e.message})`;
        $("list").innerHTML = `<button data-testid="login">Log in</button>`;
        document.querySelector("[data-testid=login]").onclick = login;
        $("setup-status").textContent = "Log in to set up an agent.";
        return;
    }
    $("status").textContent = "";
    $("list").innerHTML = renderRows(rows);
    for (const el of document.querySelectorAll("[data-testid=pending-row]")) {
        const row = rows.find((r) => String(r.pending.id) === el.dataset.id);
        const run = (method) => async () => {
            el.querySelectorAll("button").forEach((b) => (b.disabled = true));
            let err = "";
            try {
                await plugin("approvals", method, [row.pending.account, row.pending.id]);
            } catch (e) {
                err = e.message;
            }
            await refresh();
            if (err) $("status").textContent = err;
        };
        el.querySelector("[data-act=approve]").onclick = run("approve");
        el.querySelector("[data-act=grant]").onclick = run("approve-and-grant");
    }
    await refreshAgents();
}

async function refreshAgents() {
    try {
        const res = await plugin("setup", "my-agents");
        const agents = typeof res === "string" ? JSON.parse(res) : res;
        $("my-agents").innerHTML = renderMyAgents(agents);
        $("setup-status").textContent = "";
    } catch (e) {
        $("my-agents").innerHTML = "";
        $("setup-status").textContent = e.message;
    }
}

function show(step) {
    $("setup-form").hidden = step !== "form";
    $("setup-save").hidden = step !== "save";
    $("setup-confirm").hidden = step !== "confirm";
}

$("btn-create").onclick = async () => {
    const managed = $("managed-name").value.trim();
    const agent = $("agent-name").value.trim();
    $("setup-status").textContent = "Creating agent account…";
    try {
        if (!managed || !agent) throw new Error("Enter managed and agent account names");
        if (managed === agent) throw new Error("Managed and agent names must differ");
        const pem = await plugin("setup", "create-agent-account", [agent]);
        if (typeof pem !== "string" || !/BEGIN.*PRIVATE KEY/.test(pem)) {
            throw new Error(typeof pem === "string" ? pem : "create-agent-account returned no key");
        }
        pendingPem = pem;
        pendingAgent = agent;
        $("agent-pem").textContent = pem;
        show("save");
        $("setup-status").textContent = `Created ${agent}. Save the key, then confirm.`;
    } catch (e) {
        $("setup-status").textContent = e.message;
    }
};

$("saved-ack").onchange = () => {
    $("btn-continue").disabled = !$("saved-ack").checked;
};

$("btn-continue").onclick = () => {
    $("confirm-pem").value = "";
    show("confirm");
};

$("btn-copy").onclick = async () => {
    await navigator.clipboard.writeText(pendingPem);
    $("setup-status").textContent = "Copied.";
};

$("btn-download").onclick = () => {
    const blob = new Blob([pendingPem], { type: "application/x-pem-file" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${pendingAgent || "agent"}.pem`;
    a.click();
    URL.revokeObjectURL(a.href);
};

$("btn-confirm").onclick = async () => {
    const managed = $("managed-name").value.trim();
    const pasted = $("confirm-pem").value.trim();
    $("setup-status").textContent = "Confirming…";
    try {
        const ok = await plugin("setup", "confirm-agent-key", [pendingAgent, pasted]);
        if (!ok) throw new Error("Key does not match the agent account");
        await plugin("setup", "bootstrap", [managed, pendingAgent]);
        $("agent-pem").textContent = pasted;
        show("save");
        $("saved-ack").checked = true;
        $("btn-continue").disabled = false;
        pendingPem = pasted;
        await refreshAgents();
        $("setup-status").textContent = `Bootstrapped managed=${managed} agent=${pendingAgent}. Export the key for your agent.`;
    } catch (e) {
        $("setup-status").textContent = e.message;
    }
};

window.mcpRefresh = refresh;
refresh();
