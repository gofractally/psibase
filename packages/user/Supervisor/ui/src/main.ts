// DEV ONLY: Count WebAssembly.instantiate calls to measure virtual address space pressure.
// Each instantiation of a core module with its own memory reserves ~10GB of virtual
// address space for guard regions. The Memory is created internally by V8 during
// instantiate(), not via the JS WebAssembly.Memory constructor.
// Check the count after page load via: __wasmInstanceCount() in the DevTools console.
// (Brave/Chrome: type "allow pasting" in the console first to enable paste.)
let _wasmInstanceCount = 0;
const _origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = function (...args: any[]) {
    _wasmInstanceCount++;
    const isModule = args[0] instanceof WebAssembly.Module;
    console.log(
        `[wasm-mem] instantiate #${_wasmInstanceCount}`,
        isModule ? "(from Module)" : "(from bytes)",
    );
    return (_origInstantiate as any).apply(WebAssembly, args);
} as typeof WebAssembly.instantiate;
(globalThis as Record<string, unknown>).__wasmInstanceCount = () =>
    _wasmInstanceCount;
console.log("[wasm-mem] WebAssembly.instantiate tracking enabled");

import * as React from "react";
import { createRoot } from "react-dom/client";

import {
    buildMessageSupervisorInitialized,
    isFunctionCallRequest,
    isGetJsonRequest,
    isPreLoadPluginsRequest,
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib/rpc";

import { AppInterface } from "./app-interface";
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

const supervisor: AppInterface = new Supervisor();
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
window.parent.postMessage(buildMessageSupervisorInitialized(), "*");
