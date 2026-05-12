import * as React from "react";
import { createRoot } from "react-dom/client";

import {
    QualifiedFunctionCallArgs,
    buildMessageSupervisorInitialized,
    isFunctionCallRequest,
    isGetJsonRequest,
    isPreLoadPluginsRequest,
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib/rpc";

import { AppInterface } from "./app-interface";
import { camelToKebab } from "./case";
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

// Canonical internal form of intf/method is WIT kebab-case. Apps still pass
//   camelCase strings from hand-written code today; once apps consume generated
//   bindings that already emit kebab, this normalization can go.
const normalizeCallArgs = (
    args: QualifiedFunctionCallArgs,
): QualifiedFunctionCallArgs => ({
    ...args,
    intf: args.intf ? camelToKebab(args.intf) : args.intf,
    method: camelToKebab(args.method),
});

// When the supervisor is first loaded, all it does is register some handlers for
//   calls from the parent window, and also tells the parent window that it's ready.
addCallHandler(callHandlers, isFunctionCallRequest, (msg) =>
    supervisor.entry(msg.origin, msg.data.id, normalizeCallArgs(msg.data.args)),
);
addCallHandler(callHandlers, isPreLoadPluginsRequest, (msg) =>
    supervisor.preloadPlugins(msg.origin, msg.data.payload.plugins),
);
addCallHandler(callHandlers, isGetJsonRequest, (msg) =>
    supervisor.getJson(msg.origin, msg.data.id, msg.data.payload.plugin),
);
registerCallHandlers(callHandlers, (msg) => shouldHandleMessage(msg));
window.parent.postMessage(buildMessageSupervisorInitialized(), "*");
