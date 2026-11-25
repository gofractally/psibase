// Minimal app page. Instead of depending on a built @psibase/common-lib, it
// speaks the Supervisor's postMessage protocol directly (same message shapes
// as common-lib's Supervisor class): it embeds the Supervisor iframe for this
// root domain, waits for SUPERVISOR_INITIALIZED, and exposes window.e2e.
export const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>psibase e2e harness</title></head>
<body>
<button id="e2e-input" style="position:fixed;left:10px;top:10px;width:120px;height:40px">input probe</button>
<script>
  // Input probe: a real button whose click handler records when it ran.
  window.__e2eClicks = [];
  document.getElementById("e2e-input").addEventListener("click", (e) => {
    window.__e2eClicks.push({ handledAt: performance.now(), latency: performance.now() - e.timeStamp });
  });
</script>
<script>
(() => {
  const host = location.hostname.split(".").slice(1).join(".");
  const supervisorOrigin = location.protocol + "//supervisor." + host + (location.port ? ":" + location.port : "");
  const pending = new Map();
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  window.addEventListener("message", (e) => {
    if (e.origin !== supervisorOrigin) return;
    const d = e.data;
    if (d && d.type === "SUPERVISOR_INITIALIZED") resolveReady();
    else if (d && d.id && pending.has(d.id)) {
      pending.get(d.id)(d.result);
      pending.delete(d.id);
    }
  });
  const iframe = document.createElement("iframe");
  iframe.id = "iframe-supervisor";
  iframe.src = supervisorOrigin + "/";
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  const send = async (msg) => {
    await ready;
    return new Promise((resolve) => {
      pending.set(msg.id, resolve);
      iframe.contentWindow.postMessage(msg, supervisorOrigin);
    });
  };
  const id = () => crypto.randomUUID();
  window.e2e = {
    supervisorOrigin,
    ready,
    call: (args) => send({ type: "FUNCTION_CALL_REQUEST", id: id(), args: { plugin: "plugin", ...args } }),
    preload: (plugins) => send({ type: "PRE_LOAD_PLUGINS_REQUEST", id: id(), payload: { plugins } }),
  };
})();
</script>
</body></html>`;
