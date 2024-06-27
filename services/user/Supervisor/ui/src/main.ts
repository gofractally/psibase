import {
    siblingUrl,
} from "@psibase/common-lib/rpc";
import {
    isFunctionCallRequest,
    buildMessageIFrameInitialized,
    isPreLoadPluginsRequest,
} from "@psibase/common-lib/messaging";
import {
    isPluginCallResponse,
    isPluginSyncCall,
    isPreloadCompleteMessage,
} from "@psibase/supervisor-lib/messaging";

import { CallContext } from "./CallContext";
import { PluginMgr } from "./PluginMgr";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    Supervisor here
  </div>
`;

const context = new CallContext();
const callStack = context.callStack;
const pluginMgr = new PluginMgr();

// TODO: Consider if a plugin runs an infinite loop. We need a way to terminate the
//   current callstack, and report the faulty plugin that never returned.
//   And also if there's a request for IO, then the timer needs to be paused. IO has no timeout.
//   If the popup is blocked, this is considered an error, but a special error code is returned to the
//     application so it can instruct the user to enable popups. But since it's an error, cache is
//     cleared and stack emptied.


const processTop = async () => {
    if (callStack.isEmpty()) return;
    let { caller, args: { service, plugin, intf, method, params } } = callStack.peek(0)!;

    const p = pluginMgr.get({service, plugin})!;
    let resultCache = context.getCachedResults(service, plugin);
    p.loadMemory(resultCache);
    await p.call(caller, intf, method, params);
};

const isMessageFromApplication = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSameRootDomain =
        message.origin.endsWith(siblingUrl().slice("https://".length)) &&
        message.origin.startsWith("https://");
    return isTop && isParent && isSameRootDomain;
};

const appInterface = async (message: MessageEvent<any>) => {
    if (!isMessageFromApplication(message))
        return;

    try {
        if (isFunctionCallRequest(message.data)) {
            context.pushCall(message.origin, message.data.args);
            processTop();
        } else if (isPreLoadPluginsRequest(message.data)) {
            await pluginMgr.preloadPlugins(message.data.payload.plugins);
        } 
    } catch (e) {
        console.error(`Error in supervisor: ${e}`);
        context.reset();
    }
};

const pluginInterface = async(message: MessageEvent<any>) => {
    if (!pluginMgr.isMessageFromPlugin(message))
        return;
    
    try {
        if (isPluginCallResponse(message.data)) {
            context.assertPluginCallsAllowed();
            await context.popCall(message.origin, message.data.actions, message.data.result);
            processTop();
        } else if (isPluginSyncCall(message.data)) {
            context.assertPluginCallsAllowed();
            context.pushCall(message.origin, message.data.args);
            processTop();
        } else if (isPreloadCompleteMessage(message.data)) {
            // TODO: Use dependencies from the payload to DFS load other plugins
        }
    } catch (e) {
        console.error(`Error in supervisor: ${e}`);
        context.reset();
    }
};

addEventListener("message", appInterface);
addEventListener("message", pluginInterface);

const initializeSupervisor = () => {
    window.parent.postMessage(buildMessageIFrameInitialized(), "*");
};

initializeSupervisor();
