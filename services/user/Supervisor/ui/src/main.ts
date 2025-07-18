import {
    buildMessageSupervisorInitialized,
    isFunctionCallRequest,
    isGetJsonRequest,
    isPreLoadPluginsRequest,
} from "@psibase/common-lib/messaging";
import { siblingUrl } from "@psibase/common-lib/rpc";

import { AppInterface } from "./appInterace";
import { Supervisor } from "./supervisor";
import {
    CallHandler,
    addCallHandler,
    registerCallHandlers,
} from "./windowMessaging";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    Supervisor here
  </div>
`;

const supervisor: AppInterface = new Supervisor();
const callHandlers: CallHandler[] = [];

const shouldHandleMessage = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isTopSupervisor =
        !isTop &&
        window.top?.location.origin ==
            siblingUrl(null, "supervisor", null, true);
    const isParent = message.source == window.parent;
    const protocol = new URL(message.origin).protocol + "//";
    const urlSuffix = siblingUrl().slice(protocol.length);
    const isSameRootDomain = message.origin.endsWith(urlSuffix);

    const shouldRespond =
        (isTop || isTopSupervisor) && isParent && isSameRootDomain;
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
