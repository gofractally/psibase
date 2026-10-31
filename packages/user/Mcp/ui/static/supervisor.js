// Minimal Supervisor client: the same postMessage protocol as
// @psibase/common-lib's Supervisor class, without a bundler.
export function connectSupervisor() {
    const host = location.hostname.split(".").slice(1).join(".");
    const origin = `${location.protocol}//supervisor.${host}${location.port ? ":" + location.port : ""}`;
    const pending = new Map();
    let resolveReady;
    const ready = new Promise((r) => (resolveReady = r));
    window.addEventListener("message", (e) => {
        if (e.origin !== origin) return;
        const d = e.data;
        if (d && d.type === "SUPERVISOR_INITIALIZED") resolveReady();
        else if (d && d.id && pending.has(d.id)) {
            pending.get(d.id)(d.result);
            pending.delete(d.id);
        }
    });
    const iframe = document.createElement("iframe");
    iframe.id = "iframe-supervisor";
    iframe.src = origin + "/";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
    const send = async (msg) => {
        await ready;
        return new Promise((resolve) => {
            pending.set(msg.id, resolve);
            iframe.contentWindow.postMessage(msg, origin);
        });
    };
    const isRedirect = (r) => r && typeof r === "object" && r.name === "RedirectErrorObject";
    const isError = (r) => r && typeof r === "object" && typeof r.name === "string" && /ErrorObject$/.test(r.name);
    return {
        ready,
        async call(service, intf, method, params, plugin = "plugin") {
            const r = await send({
                type: "FUNCTION_CALL_REQUEST",
                id: crypto.randomUUID(),
                args: { service, plugin, intf, method, params },
            });
            // A plugin asked for a user prompt (e.g. connect an account):
            // go to the Supervisor's prompt page; it returns here afterwards.
            if (isRedirect(r) && String(r.message).includes("user_prompt_request")) {
                const url = new URL(`${origin}/prompt.html`);
                url.searchParams.set("returnPath", location.pathname);
                location.href = url.toString();
                return new Promise(() => {});
            }
            if (isError(r)) throw new Error(r.message ?? String(r));
            return r;
        },
    };
}
