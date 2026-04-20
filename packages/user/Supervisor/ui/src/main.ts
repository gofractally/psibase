import * as React from "react";
import { createRoot } from "react-dom/client";

import {
    buildMessageSupervisorInitialized,
    isFunctionCallRequest,
    isGetJsonRequest,
    isPreLoadPluginsRequest,
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib/rpc";

import { MainPage } from "./main-page";
import { Supervisor } from "./supervisor";
import { isEmbedded } from "./utils";
import {
    CallHandler,
    addCallHandler,
    registerCallHandlers,
} from "./window-messaging";

const appContainer = document.querySelector<HTMLDivElement>("#app")!;
const root = createRoot(appContainer);
root.render(React.createElement(MainPage));

const supervisor = new Supervisor();
const callHandlers: CallHandler[] = [];

const shouldHandleMessage = (message: MessageEvent) => {
    const fromTop = message.source == window.top;
    const fromParent = message.source == window.parent;

    const rootHostname = new URL(siblingUrl()).hostname;
    const messageHostname = new URL(message.origin).hostname;
    const isSameRootHostname =
        messageHostname === rootHostname ||
        messageHostname.endsWith("." + rootHostname);

    const shouldRespond =
        (fromTop || isEmbedded) && fromParent && isSameRootHostname;
    if (!shouldRespond) {
        console.error("Supervisor rejected postMessage()");
    }
    return shouldRespond;
};

// When the supervisor is first loaded, all it does is register some handlers for
//   calls from the parent window, and also tells the parent window that it's ready.
addCallHandler(callHandlers, isFunctionCallRequest, (msg) =>
    supervisor.entry(msg.origin, msg.data.id, msg.data.args),
);
addCallHandler(callHandlers, isPreLoadPluginsRequest, (msg) =>
    supervisor.preloadPlugins(msg.origin, msg.data.payload.plugins),
);
addCallHandler(callHandlers, isGetJsonRequest, (msg) =>
    supervisor.getJson(msg.origin, msg.data.id, msg.data.payload.plugin),
);
registerCallHandlers(callHandlers, (msg) => shouldHandleMessage(msg));

// Supervisor iframe cleanup on pagehide — mostly a DX affordance:
//   - Reduces the stack of supervisor iframes that can accumulate in the
//     browser's Inspector after many navigations.
//   - Every navigation loads a new supervisor iframe that will fetch/compile
//     and instantiate plugins for its own calls; that work consumes VAS
//     during active use regardless of this hook.
//   - With call-scoped dispose (every entry()/getJson()/preloadPlugins()
//     finally drops instances), completed calls leave no plugin Memories
//     behind in an old iframe beyond the parser utility — so this hook is
//     not the primary defense against Wasm instantiate / Memory OOM.
//   - If plugin instances were ever pinned across calls again and this hook
//     were removed, bfcached iframes could retain many WebAssembly.Memory
//     objects and contribute to Instantiate OOM after enough navigations.
//
// Compiled Module handles are preserved (they carry no VAS), so bfcache
// restore can re-instantiate without re-fetching or re-compiling.
// `pagehide` fires for both bfcache entry (event.persisted === true) and
// full destruction (false). Running dispose in both cases is safe under
// the Module-retention policy — the next entry() after a pageshow will
// re-instantiate on demand.
window.addEventListener("pagehide", () => {
    const disposed = supervisor.shutdown();
    if (disposed.length > 0) {
        console.log(
            `[shutdown] disposed ${disposed.length} plugin(s): [${disposed.join(", ")}]`,
        );
    }
});

window.parent.postMessage(buildMessageSupervisorInitialized(), "*");
