import { connectSupervisor } from "./supervisor.js";

const $ = (id) => document.getElementById(id);
const supervisor = connectSupervisor();
const plugin = (intf, method, params = []) => supervisor.call("mcp", intf, method, params);

function setStatus(msg) {
    $("status").textContent = msg;
}

$("btn-import").onclick = async () => {
    const account = $("agent-account").value.trim();
    const key = $("agent-key").value.trim();
    setStatus("Importing…");
    try {
        await plugin("agent-sign", "import-agent", [account, key]);
        setStatus(`Logged in as ${account}`);
    } catch (e) {
        setStatus(e.message);
    }
};

$("btn-set-profile").onclick = async () => {
    const managed = $("managed-account").value.trim();
    const displayName = $("display-name").value.trim();
    setStatus("Proposing setProfile…");
    try {
        await plugin("agent-sign", "propose-set-profile", [managed, displayName, ""]);
        setStatus("setProfile submitted (covered actions auto-execute).");
    } catch (e) {
        setStatus(e.message);
    }
};

$("btn-propose").onclick = async () => {
    const managed = $("managed-account").value.trim();
    const actions = $("actions-json").value.trim();
    setStatus("Proposing…");
    try {
        JSON.parse(actions);
        await plugin("agent-sign", "propose-as", [managed, actions]);
        setStatus("Propose submitted (covered actions auto-execute).");
    } catch (e) {
        setStatus(e.message);
    }
};

$("btn-track").onclick = async () => {
    const id = Number($("track-id").value);
    setStatus("Tracking…");
    try {
        await plugin("agent-sign", "track", [id]);
        setStatus(`Tracked staged tx #${id}`);
    } catch (e) {
        setStatus(e.message);
    }
};
