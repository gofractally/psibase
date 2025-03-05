import { siblingUrl } from "@psibase/common-lib/rpc";
import {
    isFunctionCallRequest,
    buildMessageSupervisorInitialized,
    isPreLoadPluginsRequest,
    isGetJsonRequest,
} from "@psibase/common-lib/messaging";

import { Supervisor } from "./supervisor";
import { AppInterface } from "./appInterace";
import {
    CallHandler,
    addCallHandler,
    registerCallHandlers,
} from "./windowMessaging";

const urlParams = new URLSearchParams(window.location.search);
const id = urlParams.get('id');
const returnUrl = urlParams.get('returnUrl');

const appDiv = document.querySelector<HTMLDivElement>("#app")!;

if (id && returnUrl) {
    // Create the iframe programmatically to have more control
    const iframe = document.createElement('iframe');
    
    // Set up the iframe URL
    const iframeUrl = new URL('http://permissions.psibase.localhost:8080/permissions.html');
    iframeUrl.searchParams.set('id', id);
    // iframeUrl.searchParams.set('caller', caller);
    // iframeUrl.searchParams.set('callee', callee);
    iframeUrl.searchParams.set('returnUrl', returnUrl);
    
    // Set up the iframe with minimal attributes
    iframe.src = iframeUrl.toString();
    iframe.style.width = '50%';
    iframe.style.height = '50vh';
    iframe.style.border = 'none';
    
    // Clear and append
    appDiv.innerHTML = '';
    appDiv.appendChild(iframe);
} else {
    appDiv.innerHTML = `<div>Supervisor here</div>`;
}

const supervisor: AppInterface = new Supervisor();
const callHandlers: CallHandler[] = [];

const shouldHandleMessage = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isTopSupervisor = !isTop && window.top?.location.origin == siblingUrl(null, "supervisor", null, true);
    const isParent = message.source == window.parent;
    const protocol = new URL(message.origin).protocol + "//";
    const urlSuffix = siblingUrl().slice(protocol.length);
    const isSameRootDomain = message.origin.endsWith(urlSuffix);

    const shouldRespond = (isTop || isTopSupervisor) && isParent && isSameRootDomain;
    if (!shouldRespond) {
        console.error("Supervisor rejected postMessage()");
    }
    return shouldRespond;
};

// When the supervisor is first loaded, all it does is register some handlers for
//   calls from the parent window, and also tells the parent window that it's ready.
addCallHandler(callHandlers, isFunctionCallRequest, (msg) => {
    supervisor.entry(msg.origin, msg.data.id, msg.data.args);
}
);
addCallHandler(callHandlers, isPreLoadPluginsRequest, (msg) =>
    supervisor.preloadPlugins(msg.origin, msg.data.payload.plugins),
);
addCallHandler(callHandlers, isGetJsonRequest, (msg) =>
    supervisor.getJson(msg.origin, msg.data.id, msg.data.payload.plugin),
);
registerCallHandlers(callHandlers, (msg) => shouldHandleMessage(msg));
window.parent.postMessage(buildMessageSupervisorInitialized(), "*");