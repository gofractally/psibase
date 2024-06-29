import { siblingUrl } from "@psibase/common-lib/rpc";
import {
    isFunctionCallRequest,
    buildMessageSupervisorInitialized,
    isPreLoadPluginsRequest,
} from "@psibase/common-lib/messaging";

import { Supervisor } from "./Supervisor";
import { AppInterface } from "./AppInterace";
import {
    CallHandler,
    addCallHandler,
    registerCallHandlers,
} from "./WindowMessaging";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    Supervisor here
  </div>
`;

const supervisor: AppInterface = new Supervisor();
const callHandlers: CallHandler[] = [];

const shouldHandleMessage = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSameRootDomain =
        message.origin.endsWith(siblingUrl().slice("https://".length)) &&
        message.origin.startsWith("https://");
    return isTop && isParent && isSameRootDomain;
};

addCallHandler(callHandlers, isFunctionCallRequest, (msg) =>
    supervisor.call(msg.origin, msg.data),
);
addCallHandler(callHandlers, isPreLoadPluginsRequest, (msg) =>
    supervisor.preloadPlugins(msg.origin, msg.data),
);
registerCallHandlers(callHandlers, (msg) => shouldHandleMessage(msg));

window.parent.postMessage(buildMessageSupervisorInitialized(), "*");
